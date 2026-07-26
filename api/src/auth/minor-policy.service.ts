import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
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
};

export interface MinorClassification {
  age: number;
  isMinor: boolean;
  // true si l'âge se situe dans la tranche où le parent/tuteur est requis pour les
  // actions listées dans la politique du pays (entre minParentRequiredAge et
  // civilMajorityAge) — jamais un simple booléen isMinor.
  inParentRequiredRange: boolean;
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
    if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < dateOfBirth.getDate())) {
      age--;
    }
    return age;
  }

  async classify(dateOfBirth: Date, countryCode: string): Promise<MinorClassification> {
    const policy = await this.countryPolicies.resolve(countryCode);
    const age = this.computeAge(dateOfBirth);
    return {
      age,
      isMinor: age < policy.civilMajorityAge,
      inParentRequiredRange: age >= policy.minParentRequiredAge && age < policy.civilMajorityAge,
    };
  }

  // Rejette l'inscription si le candidat n'atteint pas l'âge minimum du pays déclaré —
  // avant toute autre vérification (CLAUDE.md §1 : la protection s'applique avant
  // d'écrire la donnée, pas après coup).
  async assertMeetsMinimumAge(dateOfBirth: Date, countryCode: string): Promise<void> {
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
    const { inParentRequiredRange } = await this.classify(user.dateOfBirth, user.countryOfResidence);
    return inParentRequiredRange && policy.gatedActions.includes(action);
  }

  // Point d'entrée unique pour toute action sensible (candidature, acceptation d'offre,
  // signature, partage Digital Safe) — jamais une comparaison directe à User.isMinor
  // dans un service métier. Ne couvre pas MOBILITY, qui a son propre mécanisme de
  // consentement en direct (code envoyé au parent déjà actif) plutôt qu'une vérification
  // d'un lien déjà confirmé — voir isActionGated() pour décider de le déclencher.
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
