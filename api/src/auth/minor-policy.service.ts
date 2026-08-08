import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AccountStatus,
  MinorGatedAction,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CountryPolicyService } from './country-policy.service';

// Actions déjà gardées avant l'introduction du moteur de règles par pays (via le seul
// statut de compte AWAITING_PARENTAL_CONSENT) — préservées pour les comptes créés avant
// la migration (countryOfResidence absent), qui ne doivent jamais perdre une protection
// dont ils bénéficiaient déjà (CLAUDE.md §5 : jamais de régression silencieuse).
const LEGACY_GATED_ACTIONS: ReadonlySet<MinorGatedAction> = new Set([
  MinorGatedAction.APPLICATION_SUBMIT,
  MinorGatedAction.DIGITAL_SAFE_SHARE,
]);

const ACTION_LABELS: Record<MinorGatedAction, string> = {
  REGISTRATION: "L'inscription",
  APPLICATION_SUBMIT: 'Le dépôt de candidature',
  ACCEPT_OFFER: "L'acceptation d'une offre",
  SIGN_CONVENTION: 'La signature de la convention',
  MOBILITY: 'Le déplacement',
  DIGITAL_SAFE_SHARE: 'Le partage de documents du Digital Safe',
  SUBSCRIPTION_ORG_SPONSORED:
    'La souscription à un abonnement financé par un établissement ou une entreprise',
};

// ============================================================================
// LES QUATRE PALIERS D'ÂGE
//
// Arbitrage du promoteur du 2026-08-07 : « à coder explicitement, jamais comme
// un booléen mineur/majeur ».
//
// La raison n'est pas cosmétique. Un booléen ne distingue pas les deux paliers
// du milieu, et c'est exactement là que l'erreur coûte cher : un jeune de
// 19 ans à qui l'on propose d'indiquer un parent NE DOIT SUBIR AUCUNE
// conséquence de sa réponse. Avec un booléen, la tentation est constante de
// réutiliser le même chemin de code que pour les 14-17 ans — et de lui
// appliquer, par distraction, un blocage qui ne le concerne pas.
//
// Les bornes viennent TOUTES de CountryPolicy. Aucune n'est écrite ici.
// ============================================================================
export type AgeTier =
  // Sous l'âge légal de stage : inscription refusée.
  | 'BELOW_MINIMUM'
  // Accord parental OBLIGATOIRE pour les actions listées par la politique.
  | 'PARENTAL_CONSENT_REQUIRED'
  // Majeur. Un contact parental peut être proposé PAR COURTOISIE — sans
  // blocage, sans validation attendue, sans droit de regard.
  | 'PARENTAL_INFO_OPTIONAL'
  // Plus aucun champ parent n'est affiché.
  | 'NO_PARENTAL_INFO';

export interface MinorClassification {
  age: number;
  tier: AgeTier;
  isMinor: boolean;
  // true si l'âge se situe dans la tranche où le parent/tuteur est requis pour les
  // actions listées dans la politique du pays (entre minParentRequiredAge et
  // civilMajorityAge) — jamais un simple booléen isMinor.
  //
  // Conservé pour les appelants existants ; équivaut désormais à
  // `tier === 'PARENTAL_CONSENT_REQUIRED'`.
  inParentRequiredRange: boolean;
  // L'interface doit-elle proposer un champ parent ? Vrai pour les deux paliers
  // du milieu — mais pour deux raisons opposées, d'où `tier` pour trancher.
  showsParentalField: boolean;
}

// Moteur de règles de protection des mineurs, entièrement piloté par CountryPolicy —
// aucun seuil d'âge ni liste d'actions n'est codé en dur ici (cahier des charges).
@Injectable()
export class MinorPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countryPolicies: CountryPolicyService,
  ) {}

  computeAge(dateOfBirth: Date, at: Date = new Date()): number {
    let age = at.getFullYear() - dateOfBirth.getFullYear();
    const monthDiff = at.getMonth() - dateOfBirth.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && at.getDate() < dateOfBirth.getDate())
    ) {
      age--;
    }
    return age;
  }

  async classify(
    dateOfBirth: Date,
    countryCode: string,
  ): Promise<MinorClassification> {
    const policy = await this.countryPolicies.resolve(countryCode);
    const age = this.computeAge(dateOfBirth);
    const tier = this.tierFor(age, policy);
    return {
      age,
      tier,
      isMinor: age < policy.civilMajorityAge,
      inParentRequiredRange: tier === 'PARENTAL_CONSENT_REQUIRED',
      showsParentalField:
        tier === 'PARENTAL_CONSENT_REQUIRED' ||
        tier === 'PARENTAL_INFO_OPTIONAL',
    };
  }

  // Les paliers sont ORDONNÉS et se testent du plus bas au plus haut : chaque
  // âge tombe dans un seul, et il n'existe pas de trou entre eux. Les
  // contraintes CHECK posées en base garantissent que les seuils restent dans
  // cet ordre — sans quoi un âge pourrait ne correspondre à aucun palier.
  //
  // LA BORNE DU CONSENTEMENT EST `minParentRequiredAge`, PAS `minInternshipAge`.
  // Les deux valent 14 au Cameroun, mais le modèle autorise qu'ils diffèrent —
  // « peut différer selon la législation locale ». Un pays qui ouvrirait le
  // stage à 15 ans en n'exigeant le parent qu'à partir de 16 aurait une bande
  // de mineurs SANS obligation parentale. Découper sur `minInternshipAge`
  // imposerait un consentement à ces jeunes-là, contre la politique de leur
  // propre pays.
  private tierFor(
    age: number,
    policy: {
      minInternshipAge: number;
      minParentRequiredAge: number;
      civilMajorityAge: number;
      parentalInfoMaxAge: number;
    },
  ): AgeTier {
    if (age < policy.minInternshipAge) return 'BELOW_MINIMUM';
    if (age >= policy.minParentRequiredAge && age < policy.civilMajorityAge) {
      return 'PARENTAL_CONSENT_REQUIRED';
    }
    // Restent : la bande de mineurs sans obligation (quand les deux seuils
    // diffèrent) et les majeurs jusqu'à `parentalInfoMaxAge`. Dans les deux
    // cas, un contact parental peut être proposé sans qu'il conditionne quoi
    // que ce soit — c'est bien le même comportement.
    if (age < policy.parentalInfoMaxAge) return 'PARENTAL_INFO_OPTIONAL';
    return 'NO_PARENTAL_INFO';
  }

  // Rejette l'inscription si le candidat n'atteint pas l'âge minimum du pays déclaré —
  // avant toute autre vérification (CLAUDE.md §1 : la protection s'applique avant
  // d'écrire la donnée, pas après coup).
  async assertMeetsMinimumAge(
    dateOfBirth: Date,
    countryCode: string,
  ): Promise<void> {
    const policy = await this.countryPolicies.resolve(countryCode);
    const age = this.computeAge(dateOfBirth);
    if (age < policy.minInternshipAge) {
      throw new BadRequestException(
        `L'âge minimum pour s'inscrire depuis ce pays est de ${policy.minInternshipAge} ans.`,
      );
    }
  }

  // Répond seulement "cette action est-elle soumise à validation parentale pour ce
  // compte, selon la politique de son pays ?" — sans vérifier qu'un parent est déjà
  // rattaché. Utilisé pour des décisions d'aiguillage (ex. déclencher ou non le
  // consentement de déplacement), pas pour bloquer une action.
  async isActionGated(
    user: { dateOfBirth: Date | null; countryOfResidence: string | null },
    action: MinorGatedAction,
  ): Promise<boolean> {
    if (!user.dateOfBirth || !user.countryOfResidence) return false;
    const policy = await this.countryPolicies.resolve(user.countryOfResidence);
    const { inParentRequiredRange } = await this.classify(
      user.dateOfBirth,
      user.countryOfResidence,
    );
    return inParentRequiredRange && policy.gatedActions.includes(action);
  }

  // Point d'entrée unique pour toute action sensible (candidature, acceptation d'offre,
  // signature, partage Digital Safe) — jamais une comparaison directe à User.isMinor
  // dans un service métier. Ne couvre pas MOBILITY, qui a son propre mécanisme de
  // consentement en direct (code envoyé au parent déjà actif) plutôt qu'une vérification
  // d'un lien déjà confirmé — voir isActionGated() pour décider de le déclencher.
  // ==========================================================================
  // CE COMPTE EST-IL ENCORE MINEUR, AUJOURD'HUI ?
  //
  // À utiliser PARTOUT à la place de `User.isMinor`. Ce champ est écrit à
  // l'inscription et n'est jamais mis à jour : un jeune inscrit à 17 ans le
  // reste indéfiniment, y compris à vingt-cinq ans. Deux modules s'appuyaient
  // dessus, dont le balayage de début de stage — qui envoyait alors un SMS au
  // « représentant légal » d'un adulte, c'est-à-dire une information sur sa
  // situation professionnelle à un tiers sans titre pour la recevoir.
  //
  // Ici, l'âge est recalculé depuis la date de naissance et la politique du
  // pays. Rien n'est stocké, donc rien ne périme.
  //
  // SANS DATE DE NAISSANCE NI PAYS, on répond « oui ». On ne peut pas prouver
  // que l'obligation est éteinte, et un compte dont le statut porte encore
  // l'attente d'un consentement doit rester protégé — sens sûr de l'erreur.
  // ==========================================================================
  async requiresParentalConsent(user: {
    dateOfBirth: Date | null;
    countryOfResidence: string | null;
    status?: AccountStatus;
  }): Promise<boolean> {
    if (!user.dateOfBirth || !user.countryOfResidence) {
      return user.status === AccountStatus.AWAITING_PARENTAL_CONSENT;
    }
    const classification = await this.classify(
      user.dateOfBirth,
      user.countryOfResidence,
    );
    return classification.tier === 'PARENTAL_CONSENT_REQUIRED';
  }

  async assertActionAllowed(
    user: {
      id: string;
      dateOfBirth: Date | null;
      countryOfResidence: string | null;
      status?: AccountStatus;
    },
    action: MinorGatedAction,
  ): Promise<void> {
    // Compte créé avant l'introduction du moteur de règles (countryOfResidence absent) :
    // le nouvel engrenage par pays ne peut pas s'appliquer, mais le statut de compte
    // porte déjà le signal qu'un consentement reste attendu — ne jamais le perdre.
    if (!user.countryOfResidence) {
      if (
        LEGACY_GATED_ACTIONS.has(action) &&
        user.status === AccountStatus.AWAITING_PARENTAL_CONSENT
      ) {
        throw new ForbiddenException(
          `${ACTION_LABELS[action]} nécessite l'accord actif d'un parent ou tuteur, non encore confirmé pour ce compte.`,
        );
      }
      return;
    }

    const gated = await this.isActionGated(user, action);
    if (!gated) return;

    const activeLink = await this.prisma.parentalLink.findFirst({
      where: { childId: user.id, status: ParentalLinkStatus.ACTIVE },
    });
    if (!activeLink) {
      throw new ForbiddenException(
        `${ACTION_LABELS[action]} nécessite l'accord actif d'un parent ou tuteur, non encore confirmé pour ce compte.`,
      );
    }
  }
}
