import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NeedRequestStatus,
  OpportunityStatus,
  OpportunityType,
  OrganizationMemberStatus,
  OrganizationVerificationStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../../generated/prisma/client';
import { EducationLevel } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { RelevanceScoringService } from './relevance-scoring.service';
import { expandedTextQuery, lookupKeys } from './query-expansion';
import { diversify } from './result-diversification';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { SearchOpportunitiesDto } from './dto/search-opportunities.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import { OrganizationAccessService } from './organization-access.service';
import { OrganizationsService } from './organizations.service';

const PUBLICLY_VISIBLE_STATUSES: OpportunityStatus[] = [
  OpportunityStatus.ACTIVE,
];

// Ces types exigent une validation administrative préalable du besoin (voir
// NeedRequestsService) avant toute publication — contrairement aux stages classiques.
const TYPES_REQUIRING_NEED_APPROVAL: OpportunityType[] = [
  OpportunityType.SEASONAL,
  OpportunityType.VOLUNTEER,
  OpportunityType.TEMPORARY,
];

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationsService,
    private readonly access: OrganizationAccessService,
    private readonly scoring: RelevanceScoringService,
  ) {}

  // --- FR-M4-001 : création (brouillon) ----------------------------------------------------

  async create(userId: string, dto: CreateOpportunityDto) {
    await this.organizations.assertOwnsVerifiedOrganization(
      userId,
      dto.organizationId,
    );

    await this.assertReferentialsExist(dto.occupationId, dto.skills);

    const opportunity = await this.prisma.opportunity.create({
      data: {
        organizationId: dto.organizationId,
        title: dto.title,
        description: dto.description,
        type: dto.type,
        sector: dto.sector,
        country: dto.country,
        city: dto.city,
        workMode: dto.workMode,
        relocationRequired: dto.relocationRequired,
        accommodationProvided: dto.accommodationProvided,
        mobilityBenefits: dto.mobilityBenefits,
        occupationId: dto.occupationId,
        minEducationLevel: dto.minEducationLevel,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        ...(dto.skills?.length
          ? {
              skills: {
                create: dto.skills.map((s) => ({
                  skillId: s.skillId,
                  required: s.required ?? false,
                })),
              },
            }
          : {}),
      },
    });
    await this.audit.record('OPPORTUNITY_CREATED', userId, {
      opportunityId: opportunity.id,
    });
    return opportunity;
  }

  async update(
    userId: string,
    opportunityId: string,
    dto: UpdateOpportunityDto,
  ) {
    const opportunity = await this.assertOwnsOpportunity(userId, opportunityId);
    if (opportunity.status !== OpportunityStatus.DRAFT) {
      throw new BadRequestException(
        'Seule une offre en brouillon peut être modifiée.',
      );
    }

    // Les compétences sont une RELATION, pas une colonne : les laisser passer
    // dans `data` telles quelles ferait échouer Prisma. On les sort d'abord, et
    // du même geste on cesse de recopier un DTO entier vers la base — un champ
    // ajouté demain au DTO ne sera plus écrit sans qu'on l'ait décidé.
    const { skills, startsAt, ...champs } = dto;
    await this.assertReferentialsExist(dto.occupationId, skills);

    return this.prisma.$transaction(async (tx) => {
      // REMPLACEMENT, pas ajout : la liste envoyée est la liste voulue. Ajouter
      // sans retirer rendrait impossible de corriger une compétence saisie par
      // erreur, et l'offre deviendrait de plus en plus exigeante à chaque
      // modification.
      if (skills) {
        await tx.opportunitySkill.deleteMany({
          where: { opportunityId: opportunity.id },
        });
        if (skills.length > 0) {
          await tx.opportunitySkill.createMany({
            data: skills.map((s) => ({
              opportunityId: opportunity.id,
              skillId: s.skillId,
              required: s.required ?? false,
            })),
          });
        }
      }

      return tx.opportunity.update({
        where: { id: opportunity.id },
        data: {
          ...champs,
          ...(startsAt !== undefined
            ? { startsAt: startsAt ? new Date(startsAt) : null }
            : {}),
        },
      });
    });
  }

  // Un identifiant de métier ou de compétence qui n'existe pas, ou qui a été
  // retiré du référentiel, doit être refusé À LA SAISIE.
  //
  // La clef étrangère attraperait l'inexistant, mais pas le DÉSACTIVÉ : une
  // compétence retirée du référentiel resterait rattachable, et l'offre
  // porterait une exigence que plus aucun candidat ne peut déclarer. Elle ne
  // serait jamais satisfaite, sans que personne comprenne pourquoi.
  private async assertReferentialsExist(
    occupationId?: string,
    skills?: { skillId: string }[],
  ): Promise<void> {
    if (occupationId) {
      const metier = await this.prisma.occupation.findFirst({
        where: { id: occupationId, isActive: true },
        select: { id: true },
      });
      if (!metier) {
        throw new BadRequestException(
          'Ce métier n’existe pas ou n’est plus proposé au référentiel.',
        );
      }
    }

    if (skills?.length) {
      const ids = [...new Set(skills.map((s) => s.skillId))];
      const connues = await this.prisma.skill.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { id: true },
      });
      if (connues.length !== ids.length) {
        throw new BadRequestException(
          'Une des compétences sélectionnées n’existe pas ou n’est plus proposée au référentiel.',
        );
      }
    }
  }

  // --- FR-M4-002 / FR-M4-013 : publication et cycle de vie ---------------------------------

  async publish(userId: string, opportunityId: string) {
    const opportunity = await this.assertOwnsOpportunity(userId, opportunityId);
    this.assertTransition(opportunity.status, [OpportunityStatus.DRAFT]);

    const organization = await this.organizations.getById(
      opportunity.organizationId,
    );
    if (
      organization.verificationStatus !==
      OrganizationVerificationStatus.VERIFIED
    ) {
      throw new ForbiddenException(
        'Seule une organisation vérifiée peut publier une offre active — vérification en attente.',
      );
    }

    if (TYPES_REQUIRING_NEED_APPROVAL.includes(opportunity.type)) {
      const approvedNeed = await this.prisma.organizationNeedRequest.findFirst({
        where: {
          organizationId: opportunity.organizationId,
          type: opportunity.type,
          status: NeedRequestStatus.APPROVED,
        },
      });
      if (!approvedNeed) {
        throw new ForbiddenException(
          "Cette offre nécessite l'approbation préalable de l'administrateur (besoin saisonnier, bénévole ou temporaire) avant publication.",
        );
      }
    }

    // PENDING_REVIEW est traversé automatiquement pour le MVP — aucun workflow de
    // modération humaine n'existe encore (pas de module de gouvernance). L'état reste
    // journalisé pour anticiper une vraie file de revue plus tard.
    await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: { status: OpportunityStatus.PENDING_REVIEW },
    });
    await this.audit.record('OPPORTUNITY_PENDING_REVIEW', userId, {
      opportunityId,
    });

    const defaultDurationDays = Number(
      this.config.get<string>('OPPORTUNITY_DEFAULT_DURATION_DAYS', '60'),
    );
    const updated = await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: {
        status: OpportunityStatus.ACTIVE,
        publishedAt: new Date(),
        expiresAt:
          opportunity.expiresAt ??
          new Date(Date.now() + defaultDurationDays * 24 * 60 * 60 * 1000),
      },
    });
    await this.audit.record('OPPORTUNITY_PUBLISHED', userId, { opportunityId });
    return updated;
  }

  async pause(userId: string, opportunityId: string) {
    return this.transition(
      userId,
      opportunityId,
      [OpportunityStatus.ACTIVE],
      OpportunityStatus.PAUSED,
    );
  }

  async resume(userId: string, opportunityId: string) {
    const opportunity = await this.assertOwnsOpportunity(userId, opportunityId);
    this.assertTransition(opportunity.status, [OpportunityStatus.PAUSED]);

    const organization = await this.organizations.getById(
      opportunity.organizationId,
    );
    if (
      organization.verificationStatus !==
      OrganizationVerificationStatus.VERIFIED
    ) {
      throw new ForbiddenException(
        "Cette organisation n'est plus vérifiée — impossible de reprendre l'offre.",
      );
    }
    if (opportunity.expiresAt && opportunity.expiresAt < new Date()) {
      throw new BadRequestException(
        'Cette offre a expiré — la republier plutôt que de la reprendre.',
      );
    }

    const updated = await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: { status: OpportunityStatus.ACTIVE },
    });
    await this.audit.record('OPPORTUNITY_RESUMED', userId, { opportunityId });
    return updated;
  }

  async markFilled(userId: string, opportunityId: string) {
    return this.transition(
      userId,
      opportunityId,
      [OpportunityStatus.ACTIVE, OpportunityStatus.PAUSED],
      OpportunityStatus.FILLED,
    );
  }

  async cancel(userId: string, opportunityId: string) {
    return this.transition(
      userId,
      opportunityId,
      [
        OpportunityStatus.DRAFT,
        OpportunityStatus.PENDING_REVIEW,
        OpportunityStatus.ACTIVE,
        OpportunityStatus.PAUSED,
      ],
      OpportunityStatus.CANCELLED,
    );
  }

  // Appelé par le module Reports lors d'un signalement — jamais depuis un endpoint direct.
  async markReported(opportunityId: string) {
    const opportunity = await this.getByIdOr404(opportunityId);
    const terminal: OpportunityStatus[] = [
      OpportunityStatus.CANCELLED,
      OpportunityStatus.ARCHIVED,
      OpportunityStatus.SUSPENDED,
    ];
    if (terminal.includes(opportunity.status)) return opportunity;

    return this.prisma.opportunity.update({
      where: { id: opportunityId },
      data: { status: OpportunityStatus.REPORTED },
    });
  }

  // Suspension administrative — jamais exposée en self-service, réservée à un compte ADMIN.
  async suspend(adminUserId: string, opportunityId: string) {
    const opportunity = await this.getByIdOr404(opportunityId);
    const updated = await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: { status: OpportunityStatus.SUSPENDED },
    });
    await this.audit.record('OPPORTUNITY_SUSPENDED', adminUserId, {
      opportunityId,
    });
    return updated;
  }

  private async transition(
    userId: string,
    opportunityId: string,
    fromStatuses: OpportunityStatus[],
    toStatus: OpportunityStatus,
  ) {
    const opportunity = await this.assertOwnsOpportunity(userId, opportunityId);
    this.assertTransition(opportunity.status, fromStatuses);

    const updated = await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: { status: toStatus },
    });
    await this.audit.record(`OPPORTUNITY_${toStatus}`, userId, {
      opportunityId,
    });
    return updated;
  }

  private assertTransition(
    current: OpportunityStatus,
    allowed: OpportunityStatus[],
  ): void {
    if (!allowed.includes(current)) {
      throw new BadRequestException(
        `Transition non autorisée depuis le statut ${current}.`,
      );
    }
  }

  // --- FR-M4-003 / FR-M4-004 : recherche et consultation -----------------------------------

  // ==========================================================================
  // RECHERCHE PAR PERTINENCE
  //
  // Arbitrage du promoteur, 2026-08-07 : « recherche par pertinence seule, sans
  // sponsoring ni mise en avant payante », et « le score numérique ne doit être
  // affiché ni aux candidats ni aux entreprises ».
  //
  // TROIS ÉTAPES :
  //   1. FILTRER — critères exacts et mots-clés (plein texte, tolérant aux
  //      fautes) ;
  //   2. CLASSER — six critères pondérés depuis la base ;
  //   3. DIVERSIFIER — pour que la première page ne soit pas vingt fois la
  //      même offre.
  //
  // LA FRONTIÈRE EST ICI. Le score est calculé, il sert à ordonner, et il ne
  // franchit PAS cette méthode : seules les RAISONS de la correspondance
  // sortent, sous forme de codes que l'application traduit. « Le candidat
  // finirait par vouloir jouer l'algorithme. »
  // ==========================================================================
  async search(query: SearchOpportunitiesDto, userId?: string) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.OpportunityWhereInput = {
      status: { in: PUBLICLY_VISIBLE_STATUSES },
      ...(query.country && { country: query.country }),
      ...(query.city && { city: query.city }),
      ...(query.sector && { sector: query.sector }),
      ...(query.type && { type: query.type }),
    };

    // --- 1. LES MOTS-CLÉS ---------------------------------------------------
    // Deux passes complémentaires : le plein texte trouve les mots entiers, la
    // similarité trigramme rattrape les fautes de frappe. Les identifiants
    // retenus servent ensuite de filtre — c'est ce qui permet de garder tout le
    // reste de la requête en Prisma, donc paramétré.
    if (query.q) {
      const matchedIds = await this.matchKeywords(query.q);
      if (matchedIds.length === 0) {
        return { items: [], total: 0, page, limit };
      }
      where.id = { in: matchedIds };
    }

    // --- 2. LE CLASSEMENT ---------------------------------------------------
    // On charge une fenêtre plus large que la page demandée : classer puis
    // diversifier n'a de sens que sur un ensemble, pas sur vingt lignes déjà
    // découpées par la base.
    const FENETRE = 200;

    const [candidats, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        // Ordre de CHARGEMENT, pas de restitution : il rend la fenêtre
        // reproductible quand il y a plus de 200 résultats.
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        take: FENETRE,
        include: {
          organization: {
            select: { id: true, name: true, verificationStatus: true },
          },
          skills: { select: { skillId: true, required: true } },
          occupation: { select: { id: true, parentId: true } },
        },
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    const contexte = await this.candidateContext(userId);
    const weights = await this.scoring.weightsFor(
      query.country ?? contexte?.country ?? undefined,
    );

    const notes = candidats.map((offre) => {
      const resultat = this.scoring.score(
        {
          id: offre.id,
          city: offre.city,
          country: offre.country,
          workMode: offre.workMode,
          sector: offre.sector,
          publishedAt: offre.publishedAt,
          startsAt: offre.startsAt,
          occupationId: offre.occupationId,
          occupationFamilyId: offre.occupation?.parentId ?? null,
          minEducationLevel: offre.minEducationLevel,
          skills: offre.skills,
        },
        contexte,
        weights,
      );
      return { offre, resultat };
    });

    notes.sort(
      (a, b) =>
        b.resultat.score - a.resultat.score ||
        // Départage DÉTERMINISTE : sans lui, deux offres à égalité changeraient
        // d'ordre d'une requête à l'autre, et le classement serait
        // indéfendable devant qui le conteste.
        a.offre.id.localeCompare(b.offre.id),
    );

    // --- 3. LA DIVERSIFICATION ----------------------------------------------
    const diversifies = diversify(
      notes.map(({ offre, resultat }) => ({
        id: offre.id,
        score: resultat.score,
        organizationId: offre.organizationId,
        occupationId: offre.occupationId,
        city: offre.city,
      })),
    );

    const parId = new Map(notes.map((n) => [n.offre.id, n]));
    const ordonnes = diversifies
      .map((d) => parId.get(d.id))
      .filter((n): n is (typeof notes)[number] => Boolean(n));

    // --- LA FRONTIÈRE -------------------------------------------------------
    const items = ordonnes
      .slice((page - 1) * limit, (page - 1) * limit + limit)
      .map(({ offre, resultat }) => {
        // LISTE BLANCHE, et non retrait des champs de calcul. Retrancher
        // `skills` et `occupation` d'un objet complet laisserait passer tout
        // champ ajouté demain au modèle : on construit donc ce qui sort, plutôt
        // que d'ôter ce qui ne doit pas sortir. Même principe que pour les
        // questions de quiz.
        const {
          id,
          organizationId,
          title,
          description,
          type,
          sector,
          country,
          city,
          workMode,
          relocationRequired,
          accommodationProvided,
          mobilityBenefits,
          status,
          publishedAt,
          expiresAt,
          organization,
        } = offre;

        return {
          id,
          organizationId,
          title,
          description,
          type,
          sector,
          country,
          city,
          workMode,
          relocationRequired,
          accommodationProvided,
          mobilityBenefits,
          status,
          publishedAt,
          expiresAt,
          organization,
          // LES RAISONS, jamais le score. Des CODES, jamais des phrases :
          // l'application existe en cinq langues.
          matchReasons: resultat.matchReasons,
        };
      });

    return { items, total, page, limit };
  }

  // Recherche par mots-clés. TROIS passes complémentaires :
  //
  //   1. le PLEIN TEXTE trouve les mots entiers ;
  //   2. la SIMILARITÉ trigramme rattrape les fautes de frappe ;
  //   3. les SYNONYMES rattrapent l'écart de vocabulaire — « RH » quand l'offre
  //      dit « ressources humaines ».
  //
  // La troisième passe n'ÉLARGIT QU'EN PLUS. Si la table de synonymes est vide
  // ou se trompe, le candidat obtient exactement ce qu'il aurait obtenu sans
  // elle. Une recherche qui rendrait MOINS de résultats après « amélioration »
  // serait pire que pas d'amélioration.
  //
  // SÉCURITÉ : `websearch_to_tsquery` accepte une saisie humaine telle quelle —
  // guillemets, OU, tirets — sans jamais l'interpréter comme de la syntaxe SQL.
  // C'est la fonction faite pour ça, et elle évite d'avoir à échapper à la main
  // ce que `to_tsquery` refuserait bruyamment. Le terme élargi passe par le même
  // chemin : un PARAMÈTRE, jamais une concaténation.
  private async matchKeywords(raw: string): Promise<string[]> {
    const terme = raw.trim().slice(0, 120);
    const synonymes = await this.lookupSynonyms(terme);

    // `null` quand il n'y a rien à ajouter — et non une chaîne vide, qui
    // ferait remonter des offres au hasard.
    const elargi = expandedTextQuery(synonymes.map((s) => s.canonical));

    const [parTexte, parReferentiel] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Opportunity"
         WHERE status::text = ANY(${PUBLICLY_VISIBLE_STATUSES as string[]})
           AND ("searchVector" @@ websearch_to_tsquery('french', ${terme})
             OR similarity("title", ${terme}) > 0.25
             OR similarity("city", ${terme}) > 0.35
             OR (${elargi}::text IS NOT NULL
                 AND "searchVector" @@ websearch_to_tsquery('french', ${elargi})))
         -- ORDRE OBLIGATOIRE AVANT LA BORNE.
         --
         -- Un LIMIT sans ORDER BY laisse PostgreSQL rendre 500 lignes
         -- QUELCONQUES parmi les correspondances — et deux exécutions de la
         -- même recherche peuvent ne pas rendre les mêmes, selon le plan
         -- choisi ou la parallélisation. Au-delà de 500 correspondances, le
         -- classement cessait donc d'être reproductible, ce que le module
         -- promet pourtant explicitement.
         --
         -- Par "publishedAt" puis "id" : le même ordre de chargement que la
         -- fenêtre de 200 juste au-dessus, qui avait ce garde-fou alors que
         -- celle-ci ne l'avait pas. On départage par identifiant parce qu'une
         -- date seule laisse des ex aequo, et un ex aequo non départagé
         -- réintroduit exactement le problème.
         --
         -- Ce n'est PAS un classement : cette requête choisit quelles offres
         -- seront notées, pas dans quel ordre elles seront rendues. Trier ici
         -- par pertinence textuelle ajouterait un second critère de classement
         -- invisible, hors du barème configurable — précisément ce que le
         -- module s'interdit.
         ORDER BY "publishedAt" DESC NULLS LAST, id ASC
         LIMIT 500
      `,
      this.matchByReferential(synonymes),
    ]);

    return [...new Set([...parTexte.map((row) => row.id), ...parReferentiel])];
  }

  // Les synonymes ACTIFS qui correspondent à la requête.
  //
  // Une seule requête, quelle que soit la longueur de la saisie : les clefs
  // possibles (requête entière, mots, paires adjacentes) sont calculées d'abord
  // puis cherchées d'un coup.
  private async lookupSynonyms(raw: string) {
    const clefs = lookupKeys(raw);
    if (clefs.length === 0) return [];

    return this.prisma.searchSynonym.findMany({
      where: { isActive: true, termNormalized: { in: clefs } },
      select: { canonical: true, skillId: true, occupationId: true },
    });
  }

  // Les offres rattachées aux COMPÉTENCES ou aux MÉTIERS visés par un synonyme.
  //
  // C'est la moitié la plus utile de l'expansion, et celle qu'aucune recherche
  // plein texte ne peut faire : une offre étiquetée « JavaScript » au
  // référentiel remonte pour « JS » même si le texte de l'annonce ne contient
  // ni l'un ni l'autre. Le référentiel sert alors à ce pour quoi il existe —
  // relier des choses que les mots ne relient pas.
  private async matchByReferential(
    synonymes: { skillId: string | null; occupationId: string | null }[],
  ): Promise<string[]> {
    const skillIds = synonymes
      .map((s) => s.skillId)
      .filter((id): id is string => id !== null);
    const occupationIds = synonymes
      .map((s) => s.occupationId)
      .filter((id): id is string => id !== null);

    if (skillIds.length === 0 && occupationIds.length === 0) return [];

    const offres = await this.prisma.opportunity.findMany({
      where: {
        // Le statut est refiltré plus loin par la requête principale, mais il
        // doit l'être ICI AUSSI : sans lui, la limite de 500 se remplirait de
        // brouillons et de suspendues, qui évinceraient les offres actives
        // avant même d'arriver au filtre. Une borne appliquée avant le tri
        // décide silencieusement de ce qu'on ne verra jamais.
        status: { in: PUBLICLY_VISIBLE_STATUSES },
        OR: [
          ...(skillIds.length
            ? [{ skills: { some: { skillId: { in: skillIds } } } }]
            : []),
          ...(occupationIds.length
            ? [{ occupationId: { in: occupationIds } }]
            : []),
        ],
      },
      select: { id: true },
      // Même raison que la passe plein texte : une borne sans ordre rend des
      // lignes quelconques, et le classement cesserait d'être reproductible
      // au-delà de 500 correspondances.
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: 500,
    });

    return offres.map((offre) => offre.id);
  }

  // Ce que le moteur sait du candidat. Réduit à ce qui sert au calcul : ni nom,
  // ni téléphone, ni identifiant de compte (CLAUDE.md §1 — le profil est
  // Confidentiel, il entre dans le calcul et n'en ressort jamais).
  private async candidateContext(userId?: string) {
    if (!userId) return null;

    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: {
        availableFrom: true,
        targetOccupationId: true,
        targetOccupation: { select: { parentId: true } },
        skills: { select: { skillId: true } },
        educations: { select: { level: true } },
        user: { select: { countryOfResidence: true, cityOfResidence: true } },
      },
    });
    if (!profile) return null;

    // Le PLUS HAUT niveau atteint : quelqu'un qui a un master et une licence
    // possède un master.
    const niveaux = profile.educations
      .map((e) => e.level)
      .filter((l): l is NonNullable<typeof l> => Boolean(l));

    return {
      skillIds: profile.skills.map((s) => s.skillId),
      targetOccupationId: profile.targetOccupationId,
      occupationFamilyId: profile.targetOccupation?.parentId ?? null,
      city: profile.user.cityOfResidence,
      country: profile.user.countryOfResidence,
      educationLevel: highestEducationLevel(niveaux),
      availableFrom: profile.availableFrom,
    };
  }

  async getById(userId: string | undefined, opportunityId: string) {
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: {
        organization: {
          select: { id: true, name: true, verificationStatus: true },
        },
      },
    });
    if (!opportunity) throw new NotFoundException('Offre introuvable.');

    const isPublic = PUBLICLY_VISIBLE_STATUSES.includes(opportunity.status);
    const isParticipant =
      userId &&
      opportunity.organization &&
      (await this.access.isParticipant(opportunity.organizationId, userId));
    if (!isPublic && !isParticipant) {
      throw new NotFoundException('Offre introuvable.');
    }
    return opportunity;
  }

  async listMine(userId: string) {
    const myOrganizations = await this.prisma.organization.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: { userId, status: OrganizationMemberStatus.ACTIVE },
            },
          },
        ],
      },
      select: { id: true },
    });
    return this.prisma.opportunity.findMany({
      where: { organizationId: { in: myOrganizations.map((org) => org.id) } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByIdOr404(opportunityId: string) {
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
    });
    if (!opportunity) throw new NotFoundException('Offre introuvable.');
    return opportunity;
  }

  // FR-ORG-002 : délègue à OrganizationAccessService — propriétaire ou membre d'équipe
  // autorisé (RECRUITER/ADMIN), pas seulement le propriétaire de l'organisation.
  async assertOwnsOpportunity(userId: string, opportunityId: string) {
    const opportunity = await this.getByIdOr404(opportunityId);
    await this.access.assertCanManage(opportunity.organizationId, userId);
    return opportunity;
  }
}

// Le PLUS HAUT niveau atteint parmi les formations déclarées. Quelqu'un qui a un
// master et une licence possède un master : prendre la dernière saisie, ou la
// plus récente par date, donnerait un résultat dépendant de l'ordre de saisie.
const EDUCATION_ORDER: EducationLevel[] = [
  EducationLevel.NONE,
  EducationLevel.SECONDARY,
  EducationLevel.BAC,
  EducationLevel.BAC_PLUS_2,
  EducationLevel.BAC_PLUS_3,
  EducationLevel.BAC_PLUS_5,
  EducationLevel.DOCTORATE,
];

function highestEducationLevel(
  levels: EducationLevel[],
): EducationLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((plusHaut, courant) =>
    EDUCATION_ORDER.indexOf(courant) > EDUCATION_ORDER.indexOf(plusHaut)
      ? courant
      : plusHaut,
  );
}
