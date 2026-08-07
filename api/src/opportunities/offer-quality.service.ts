import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OpportunityStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from './organization-access.service';

// ============================================================================
// DIAGNOSTIC DE QUALITÉ D'UNE OFFRE
//
// Arbitrage du promoteur, 2026-08-07 : « Le score numérique ne doit être
// affiché ni aux candidats ni aux entreprises. Les candidats verront uniquement
// les raisons de la correspondance, et les entreprises un diagnostic de qualité
// de leur offre avec des recommandations d'amélioration. »
//
// CE SERVICE NE SAIT RIEN DU CLASSEMENT. C'est sa propriété essentielle, et
// elle est structurelle : il n'a pas `RelevanceScoringService` en dépendance,
// il ne lit AUCUNE autre offre, et il ne compte pas les candidatures reçues.
// Il ne peut donc pas répondre à « où est-ce que je me situe ? », parce qu'il
// n'en sait rien.
//
// POURQUOI C'EST UN CHOIX ET PAS UNE LIMITE. Un diagnostic qui dirait « votre
// offre est 7e » deviendrait un plateau de jeu : on chercherait le geste qui
// fait gagner une place, puis celui d'après. Le classement par pertinence
// deviendrait une compétition d'optimisation — le sponsoring par un autre
// chemin, sans qu'aucun euro ne change de main.
//
// Ce que le diagnostic examine, c'est donc l'offre SEULE, face à ce dont le
// moteur a besoin pour la rapprocher de quelqu'un. « Vous n'avez déclaré aucune
// compétence » est vrai indépendamment des autres offres, et reste vrai demain.
//
// PAS DE NOTE NON PLUS. Ni sur 100, ni en étoiles : une note se compare, donc
// se poursuit. Trois niveaux nommés, et surtout une LISTE DE POINTS, chacun
// avec sa recommandation. C'est la liste qui est utile ; le niveau n'est qu'un
// résumé pour l'écran d'accueil.
//
// AUCUNE PHRASE CONSTRUITE ICI. L'application existe en cinq langues : ce
// service rend des CODES, l'interface les traduit.
// ============================================================================

// Les points examinés. Un code par point — l'ordre de cette énumération est
// l'ordre d'IMPACT, du plus lourd au plus léger, calqué sur le barème.
export enum QualityCheck {
  // 35 points de pertinence. Sans compétence déclarée, le critère le plus lourd
  // du barème rend zéro pour tout le monde : l'offre ne peut être rapprochée de
  // personne par ce qu'elle demande vraiment.
  SKILLS_DECLARED = 'SKILLS_DECLARED',
  // 25 points. Sans métier rattaché, l'offre ne remonte ni pour ceux qui visent
  // ce métier, ni pour ceux qui visent sa famille.
  OCCUPATION_LINKED = 'OCCUPATION_LINKED',
  // La description nourrit la recherche par mots-clés (poids C du plein texte)
  // et c'est elle que le candidat lit avant de postuler.
  DESCRIPTION_SUBSTANTIAL = 'DESCRIPTION_SUBSTANTIAL',
  // Un intitulé de deux mots ne dit pas de quel poste il s'agit — et il pèse le
  // plus lourd dans la recherche plein texte (poids A).
  TITLE_INFORMATIVE = 'TITLE_INFORMATIVE',
  // 5 points. La date de début permet de savoir si le candidat sera libre.
  START_DATE_SET = 'START_DATE_SET',
  // 10 points, qui décroissent seuls. Une offre ancienne descend d'elle-même.
  STILL_FRESH = 'STILL_FRESH',
  // Le niveau d'études n'améliore PAS la pertinence quand il est renseigné —
  // une offre sans exigence n'exclut personne et obtient déjà la note pleine.
  // Il est examiné pour la clarté due au candidat, pas pour le classement.
  EDUCATION_STATED = 'EDUCATION_STATED',
  // Une offre sur site dans une ville, ou à distance : le candidat doit pouvoir
  // savoir s'il peut la prendre.
  LOCATION_USABLE = 'LOCATION_USABLE',
}

export type CheckVerdict = 'OK' | 'A_AMELIORER' | 'MANQUANT';

// Trois niveaux NOMMÉS, pas une note. Le pluriel de « note » est « comparaison ».
export type QualityLevel = 'INCOMPLETE' | 'PERFECTIBLE' | 'COMPLETE';

export interface QualityPoint {
  check: QualityCheck;
  verdict: CheckVerdict;
  // Le code de recommandation, absent quand le point est bon. L'interface le
  // traduit ; il n'y a pas de phrase française dans cette réponse.
  recommendation?: QualityCheck;
}

export interface OfferQualityReport {
  opportunityId: string;
  level: QualityLevel;
  points: QualityPoint[];
}

// Seuils de forme. Volontairement bas : le diagnostic doit signaler ce qui
// empêche le rapprochement, pas imposer un style rédactionnel.
const TITRE_MINIMUM_MOTS = 3;
const DESCRIPTION_MINIMUM_CARACTERES = 200;
const FRAICHEUR_ALERTE_JOURS = 60;

@Injectable()
export class OfferQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  // Le diagnostic d'UNE offre, pour l'organisation qui la publie.
  //
  // Le contrôle d'accès est le premier geste : le diagnostic révèle des faits
  // sur une offre — dont son ancienneté et ce qu'elle omet — que son
  // concurrent n'a pas à connaître.
  async diagnose(
    opportunityId: string,
    userId: string,
    now = new Date(),
  ): Promise<OfferQualityReport> {
    const offre = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: {
        id: true,
        organizationId: true,
        title: true,
        description: true,
        city: true,
        workMode: true,
        status: true,
        publishedAt: true,
        startsAt: true,
        occupationId: true,
        minEducationLevel: true,
        _count: { select: { skills: true } },
      },
    });
    if (!offre) throw new NotFoundException('Offre introuvable.');

    // TOUT MEMBRE de l'organisation, y compris un VIEWER : le diagnostic est
    // une lecture. Interdire au consultant de voir ce qui manque à une offre
    // qu'il peut déjà lire n'ajouterait aucune protection.
    const acces = await this.access.getAccess(offre.organizationId, userId);
    if (!acces) {
      throw new ForbiddenException(
        'Le diagnostic d’une offre est réservé à l’organisation qui la publie.',
      );
    }

    return this.evaluate(offre, now);
  }

  // Le calcul, séparé de la lecture et du contrôle d'accès : il ne touche à
  // rien, ne lit rien d'autre, et se teste seul.
  evaluate(offre: DiagnosableOffer, now = new Date()): OfferQualityReport {
    const points: QualityPoint[] = [
      this.point(
        QualityCheck.SKILLS_DECLARED,
        offre._count.skills === 0 ? 'MANQUANT' : 'OK',
      ),
      this.point(
        QualityCheck.OCCUPATION_LINKED,
        offre.occupationId ? 'OK' : 'MANQUANT',
      ),
      this.point(
        QualityCheck.DESCRIPTION_SUBSTANTIAL,
        offre.description.trim().length >= DESCRIPTION_MINIMUM_CARACTERES
          ? 'OK'
          : 'A_AMELIORER',
      ),
      this.point(
        QualityCheck.TITLE_INFORMATIVE,
        offre.title.trim().split(/\s+/).filter(Boolean).length >=
          TITRE_MINIMUM_MOTS
          ? 'OK'
          : 'A_AMELIORER',
      ),
      this.point(
        QualityCheck.START_DATE_SET,
        offre.startsAt ? 'OK' : 'A_AMELIORER',
      ),
      this.point(QualityCheck.STILL_FRESH, this.freshnessVerdict(offre, now)),
      this.point(
        QualityCheck.EDUCATION_STATED,
        offre.minEducationLevel ? 'OK' : 'A_AMELIORER',
      ),
      this.point(QualityCheck.LOCATION_USABLE, this.locationVerdict(offre)),
    ];

    return { opportunityId: offre.id, level: this.levelOf(points), points };
  }

  private point(check: QualityCheck, verdict: CheckVerdict): QualityPoint {
    return {
      check,
      verdict,
      ...(verdict === 'OK' ? {} : { recommendation: check }),
    };
  }

  // Une offre non publiée n'a pas d'ancienneté : lui reprocher d'être vieille
  // serait absurde, et découragerait précisément le travail de brouillon que la
  // plateforme veut encourager.
  private freshnessVerdict(offre: DiagnosableOffer, now: Date): CheckVerdict {
    if (offre.status !== OpportunityStatus.ACTIVE || !offre.publishedAt) {
      return 'OK';
    }
    const jours = (now.getTime() - offre.publishedAt.getTime()) / 86_400_000;
    return jours > FRAICHEUR_ALERTE_JOURS ? 'A_AMELIORER' : 'OK';
  }

  private locationVerdict(offre: DiagnosableOffer): CheckVerdict {
    // Une offre à distance n'a pas besoin de ville : elle est partout.
    if (offre.workMode === 'REMOTE') return 'OK';
    return offre.city.trim().length > 0 ? 'OK' : 'MANQUANT';
  }

  // Le niveau se déduit des points, il ne se calcule pas à part — sans quoi
  // l'un pourrait dire le contraire de l'autre.
  //
  // UN SEUL MANQUE SUFFIT À DIRE « INCOMPLÈTE ». Les deux points qui peuvent
  // manquer (compétences, métier) valent 60 des 100 points du barème : une
  // offre qui les omet ne peut être rapprochée de personne sur ce qu'elle
  // demande. Moyenner cela avec des points de forme le dirait moins fort qu'il
  // ne l'est.
  private levelOf(points: QualityPoint[]): QualityLevel {
    if (points.some((p) => p.verdict === 'MANQUANT')) return 'INCOMPLETE';
    if (points.some((p) => p.verdict === 'A_AMELIORER')) return 'PERFECTIBLE';
    return 'COMPLETE';
  }
}

// Ce que le diagnostic a besoin de savoir. Ni le nom de l'organisation, ni les
// candidatures reçues, ni quoi que ce soit d'une autre offre : la forme de ce
// type est ce qui rend la garantie vérifiable.
export interface DiagnosableOffer {
  id: string;
  title: string;
  description: string;
  city: string;
  workMode: string;
  status: OpportunityStatus;
  publishedAt: Date | null;
  startsAt: Date | null;
  occupationId: string | null;
  minEducationLevel: string | null;
  _count: { skills: number };
}
