import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CommissionRule } from '../../generated/prisma/client';
import type {
  AmbassadorCategory,
  AmbassadorTier,
  CommissionNature,
  ProductType,
} from '../../generated/prisma/enums';
import { AuditService, diffOf } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export interface RateQuery {
  productType: ProductType;
  productKey: string;
  nature: CommissionNature;
  ambassadorCategory: AmbassadorCategory;
  ambassadorTier: AmbassadorTier;
  countryCode: string;
  campaignKey?: string | null;
  at: Date;
  // Volume de ventes du mois, nécessaire UNIQUEMENT pour départager les règles à
  // palier. Laissé indéfini au lancement : voir la note sur les paliers plus bas.
  monthlySalesCount?: number;
}

export interface RateResolution {
  rule: CommissionRule | null;
  rateBasisPoints: number | null;
  // Prime forfaitaire, lorsque le barème en exprime une plutôt qu'un taux.
  // Exactement l'un des deux est renseigné — la base le garantit par contrainte.
  fixedAmountMinor: number | null;
  // Trace conservée dans Commission.resolutionTrace : elle permet de répondre, deux
  // ans après, à « pourquoi ai-je touché 8 % et non 15 % sur cette vente ? ».
  trace: {
    query: Omit<RateQuery, 'at'> & { at: string };
    candidateIds: string[];
    skippedTieredIds: string[];
    chosenId: string | null;
    reason: string;
  };
}

@Injectable()
export class CommissionRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Résout le taux applicable à une vente.
  //
  // Sémantique des critères : un critère NUL dans une règle vaut « n'importe quelle
  // valeur ». Une règle sans pays s'applique partout, une règle sans niveau
  // s'applique à tous les niveaux. C'est ce qui permet d'ajouter les niveaux
  // Bronze→Diamant plus tard sans toucher à ce code : il suffira de créer des règles
  // portant un niveau, qui l'emporteront sur les règles génériques déjà en place.
  //
  // Départage, dans cet ordre :
  //   1. priority la plus haute — le levier explicite de l'administration ;
  //   2. à priorité égale, la règle la plus SPÉCIFIQUE (le plus de critères
  //      renseignés), parce qu'une règle « Carrière Plus au Cameroun » doit battre
  //      une règle « tous produits, tous pays » sans qu'on ait à y penser ;
  //   3. à spécificité égale, la plus récemment entrée en vigueur.
  async resolve(query: RateQuery): Promise<RateResolution> {
    const rules = await this.prisma.commissionRule.findMany({
      where: {
        isActive: true,
        productType: query.productType,
        nature: query.nature,
        validFrom: { lte: query.at },
        OR: [{ validUntil: null }, { validUntil: { gt: query.at } }],
        AND: [
          { OR: [{ productKey: null }, { productKey: query.productKey }] },
          {
            OR: [
              { ambassadorCategory: null },
              { ambassadorCategory: query.ambassadorCategory },
            ],
          },
          {
            OR: [
              { ambassadorTier: null },
              { ambassadorTier: query.ambassadorTier },
            ],
          },
          { OR: [{ countryCode: null }, { countryCode: query.countryCode }] },
          {
            OR: [
              { campaignKey: null },
              ...(query.campaignKey
                ? [{ campaignKey: query.campaignKey }]
                : []),
            ],
          },
        ],
      },
    });

    // PALIERS DE VOLUME — construits, désactivés au lancement (décision du promoteur).
    // Une règle à palier est ÉCARTÉE tant qu'on ne fournit pas le volume du mois :
    // l'appliquer sans le mesurer reviendrait à supposer un chiffre, et à payer sur
    // cette supposition. Les activer plus tard consistera à renseigner
    // `monthlySalesCount` — ce code n'aura pas à changer.
    const skippedTiered: string[] = [];
    const applicable = rules.filter((rule) => {
      if (rule.minMonthlySalesCount === null) return true;
      if (query.monthlySalesCount === undefined) {
        skippedTiered.push(rule.id);
        return false;
      }
      return query.monthlySalesCount >= rule.minMonthlySalesCount;
    });

    const { at, ...restOfQuery } = query;
    const trace: RateResolution['trace'] = {
      query: { ...restOfQuery, at: at.toISOString() },
      candidateIds: applicable.map((rule) => rule.id),
      skippedTieredIds: skippedTiered,
      chosenId: null,
      reason: '',
    };

    if (applicable.length === 0) {
      // AUCUNE règle : on ne crée AUCUNE commission, et surtout on n'invente pas un
      // taux « raisonnable ». Sur de l'argent, l'absence de barème est une question
      // à poser à l'administration, pas un trou à combler par une valeur plausible.
      trace.reason = 'AUCUNE_REGLE_APPLICABLE';
      return {
        rule: null,
        rateBasisPoints: null,
        fixedAmountMinor: null,
        trace,
      };
    }

    const winner = applicable.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      const specificityGap = specificity(b) - specificity(a);
      if (specificityGap !== 0) return specificityGap;
      return b.validFrom.getTime() - a.validFrom.getTime();
    })[0];

    trace.chosenId = winner.id;
    trace.reason =
      applicable.length === 1
        ? 'REGLE_UNIQUE'
        : `DEPARTAGE priority=${winner.priority} specificite=${specificity(winner)}`;

    return {
      rule: winner,
      rateBasisPoints: winner.rateBasisPoints,
      fixedAmountMinor: winner.fixedAmountMinor,
      trace,
    };
  }

  // Applique un taux à une assiette. Arrondi à l'INFÉRIEUR à dessein : entre payer un
  // franc de trop et un franc de moins sur chaque vente, la seconde erreur est la
  // seule qui ne crée pas, à grande échelle, un passif que personne n'a décidé.
  computeAmountMinor(
    basisAmountMinor: number,
    rateBasisPoints: number | null,
    fixedAmountMinor: number | null = null,
  ): number {
    // Une prime forfaitaire ne dépend PAS de l'assiette : 5 000 F par
    // souscription valent 5 000 F, que l'abonnement coûte 10 000 ou 200 000.
    if (fixedAmountMinor !== null) return fixedAmountMinor;

    // Ni taux ni montant : le barème est incalculable. Rendre zéro en silence
    // ferait travailler un ambassadeur gratuitement sans que personne ne s'en
    // aperçoive — la base interdit d'ailleurs ce cas par contrainte CHECK, et si
    // on arrive ici c'est que quelque chose de plus grave s'est produit.
    if (rateBasisPoints === null) {
      throw new BadRequestException(
        'Barème sans taux ni montant fixe : commission incalculable.',
      );
    }

    return Math.floor((basisAmountMinor * rateBasisPoints) / 10000);
  }

  // --- Gestion des barèmes (back-office) -------------------------------------

  // Crée une NOUVELLE lignée de barème. Pour faire évoluer un barème existant,
  // utiliser `supersede()` : c'est ce qui préserve l'historique.
  async create(adminUserId: string, input: CommissionRuleInput) {
    this.assertCalculationMode(input);

    const rule = await this.prisma.commissionRule.create({
      data: {
        ...this.toData(input),
        // Une lignée neuve : la clé sera réécrite avec l'identifiant produit, de
        // sorte qu'elle soit stable et sans collision.
        lineageKey: 'temporaire',
        version: 1,
        createdById: adminUserId,
      },
    });

    const finalized = await this.prisma.commissionRule.update({
      where: { id: rule.id },
      data: { lineageKey: rule.id },
    });

    await this.audit.recordChange('COMMISSION_RULE_CREATED', adminUserId, {
      entityType: 'CommissionRule',
      entityId: rule.id,
      metadata: {
        lineageKey: finalized.lineageKey,
        version: 1,
        label: finalized.label,
      },
    });

    return finalized;
  }

  // REMPLACE un barème par une nouvelle version. C'est la SEULE façon de faire
  // évoluer les conditions économiques d'un barème déjà en vigueur.
  //
  // Le promoteur a exigé qu'« une modification future du barème ne recalcule jamais
  // rétroactivement une commission déjà acquise ». Modifier un taux EN PLACE
  // satisferait cette exigence pour les commissions passées — elles gardent leur
  // photographie — mais rendrait la question « quel était le taux le 15 mars ? »
  // sans réponse. La version close, elle, reste consultable pour toujours.
  async supersede(
    adminUserId: string,
    ruleId: string,
    input: CommissionRuleInput,
    effectiveFrom = new Date(),
  ) {
    this.assertCalculationMode(input);

    const current = await this.prisma.commissionRule.findUnique({
      where: { id: ruleId },
    });
    if (!current) throw new NotFoundException('Barème introuvable.');

    if (current.validUntil !== null) {
      throw new ConflictException(
        'Ce barème est déjà clos. Remplacez sa version la plus récente.',
      );
    }
    if (effectiveFrom <= current.validFrom) {
      // Sans cela on créerait deux versions valides au même instant, et le
      // départage deviendrait un coup de dé.
      throw new BadRequestException(
        'La nouvelle version doit prendre effet après le début de la version remplacée.',
      );
    }

    const [closed, next] = await this.prisma.$transaction([
      // La version sortante est CLOSE, jamais supprimée ni modifiée dans ses
      // conditions économiques.
      this.prisma.commissionRule.update({
        where: { id: ruleId },
        data: { validUntil: effectiveFrom },
      }),
      this.prisma.commissionRule.create({
        data: {
          ...this.toData(input),
          lineageKey: current.lineageKey,
          version: current.version + 1,
          supersedesId: current.id,
          validFrom: effectiveFrom,
          createdById: adminUserId,
        },
      }),
    ]);

    await this.audit.recordChange('COMMISSION_RULE_SUPERSEDED', adminUserId, {
      entityType: 'CommissionRule',
      entityId: next.id,
      // L'audit dit ce qui a changé économiquement, pas seulement qu'il y a eu
      // une nouvelle version.
      changes: diffOf(
        {
          rateBasisPoints: closed.rateBasisPoints,
          fixedAmountMinor: closed.fixedAmountMinor,
          currency: closed.currency,
        },
        {
          rateBasisPoints: next.rateBasisPoints,
          fixedAmountMinor: next.fixedAmountMinor,
          currency: next.currency,
        },
      ),
      metadata: {
        lineageKey: current.lineageKey,
        supersededId: closed.id,
        fromVersion: closed.version,
        toVersion: next.version,
      },
    });

    return { closed, next };
  }

  // Retire un barème du jeu SANS le supprimer : les commissions qu'il a produites
  // doivent rester justifiables.
  async deactivate(adminUserId: string, ruleId: string) {
    const rule = await this.prisma.commissionRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) throw new NotFoundException('Barème introuvable.');

    const updated = await this.prisma.commissionRule.update({
      where: { id: ruleId },
      data: { isActive: false, validUntil: rule.validUntil ?? new Date() },
    });

    await this.audit.recordChange('COMMISSION_RULE_DEACTIVATED', adminUserId, {
      entityType: 'CommissionRule',
      entityId: ruleId,
      changes: diffOf({ isActive: true }, { isActive: false }),
      metadata: { lineageKey: rule.lineageKey, version: rule.version },
    });

    return updated;
  }

  // Toutes les versions d'une lignée, de la plus ancienne à la plus récente.
  // Répond à « quel était le barème le 15 mars ? ».
  async lineage(lineageKey: string) {
    return this.prisma.commissionRule.findMany({
      where: { lineageKey },
      orderBy: { version: 'asc' },
    });
  }

  // Le service refuse ce que la base refuse déjà. Deux verrous, et surtout un
  // message d'erreur compréhensible plutôt qu'une violation de contrainte brute.
  private assertCalculationMode(input: CommissionRuleInput) {
    const hasRate =
      input.rateBasisPoints !== undefined && input.rateBasisPoints !== null;
    const hasFixed =
      input.fixedAmountMinor !== undefined && input.fixedAmountMinor !== null;

    if (hasRate === hasFixed) {
      throw new BadRequestException(
        'Un barème exprime SOIT un taux, SOIT un montant fixe — jamais les deux, jamais aucun.',
      );
    }
    if (hasFixed && !input.currency) {
      throw new BadRequestException(
        'Un montant fixe exige une devise : « 5 000 » sans devise n’est pas une somme.',
      );
    }
  }

  private toData(input: CommissionRuleInput) {
    return {
      label: input.label,
      productType: input.productType,
      productKey: input.productKey ?? null,
      nature: input.nature,
      ambassadorCategory: input.ambassadorCategory ?? null,
      ambassadorTier: input.ambassadorTier ?? null,
      countryCode: input.countryCode ?? null,
      campaignKey: input.campaignKey ?? null,
      rateBasisPoints: input.rateBasisPoints ?? null,
      fixedAmountMinor: input.fixedAmountMinor ?? null,
      currency: input.currency ?? null,
      minAmountMinor: input.minAmountMinor ?? null,
      maxAmountMinor: input.maxAmountMinor ?? null,
      minMonthlySalesCount: input.minMonthlySalesCount ?? null,
      priority: input.priority ?? 0,
    };
  }
}

// Conditions économiques d'un barème. Volontairement séparé du DTO HTTP : le
// service doit pouvoir être appelé depuis un script d'amorçage sans passer par la
// validation d'une requête.
export interface CommissionRuleInput {
  label: string;
  productType: ProductType;
  productKey?: string | null;
  nature: CommissionNature;
  ambassadorCategory?: AmbassadorCategory | null;
  ambassadorTier?: AmbassadorTier | null;
  countryCode?: string | null;
  campaignKey?: string | null;
  rateBasisPoints?: number | null;
  fixedAmountMinor?: number | null;
  currency?: string | null;
  minAmountMinor?: number | null;
  maxAmountMinor?: number | null;
  minMonthlySalesCount?: number | null;
  priority?: number;
}

// Nombre de critères réellement discriminants renseignés sur la règle.
function specificity(rule: CommissionRule): number {
  return [
    rule.productKey,
    rule.ambassadorCategory,
    rule.ambassadorTier,
    rule.countryCode,
    rule.campaignKey,
  ].filter((criterion) => criterion !== null).length;
}
