import { Injectable } from '@nestjs/common';
import {
  SubscriptionPlan,
  SubscriptionStatus,
  UserPath,
} from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { INDIVIDUAL_PLANS } from '../subscriptions/individual-plans';
import {
  CAPABILITIES,
  EntitlementReason,
  type EntitlementCapability,
  type EntitlementDecision,
} from './entitlement-capability';
import {
  ENTITLEMENT_CATALOGUE,
  ORDRE_DE_PROPOSITION,
} from './entitlement-catalogue';

// ============================================================================
// LE SEUL ENDROIT OÙ L'ON DÉCIDE CE QU'UNE FORMULE AUTORISE
//
// Aucun autre module ne lit le catalogue — ESLint l'interdit — et aucun autre
// ne lit un abonnement pour en tirer un droit : un test de source confine cette
// lecture à `subscriptions/` et à ce dossier. Les deux mécanismes visent la même
// chose : qu'il n'existe jamais deux réponses à la même question.
//
// CE QUE CE SERVICE NE FAIT PAS, ET NE DOIT JAMAIS FAIRE :
//   — il ne décide pas QUI agit : c'est le RBAC, et il ne le lit pas ;
//   — il ne décide pas d'un prix ni d'une éligibilité à l'achat : c'est D-21,
//     qui vit dans `subscriptions/` et n'entre jamais ici ;
//   — il ne connaît ni `Organization.category`, ni `currentPath`, ni les règles
//     mineurs. Trois tests de source l'imposent.
//
// EN V6-4 IL NE GARDE RIEN, le catalogue étant vide, et le type
// `EntitlementCapability` valant `never` : aucun appelant TypeScript ne peut
// donc l'appeler légitimement. Les contrôles d'exécution ci-dessous sont une
// défense en profondeur pour une valeur ayant franchi la frontière du typage —
// paramètre HTTP, corps JSON, appel non typé.
// ============================================================================
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async actifs(userId: string): Promise<{
    plan: SubscriptionPlan | null;
    entitlements: EntitlementCapability[];
  }> {
    const [abonnement, user] = await Promise.all([
      this.abonnementIndividuelLePlusRecent(userId),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { currentPath: true },
      }),
    ]);
    if (
      !abonnement ||
      !this.estCouvert(abonnement.status, abonnement.currentPeriodEnd)
    ) {
      return { plan: null, entitlements: [] };
    }
    if (
      (abonnement.plan === SubscriptionPlan.CARRIERE_SECURISEE &&
        user?.currentPath !== UserPath.ACADEMIC) ||
      (abonnement.plan === SubscriptionPlan.CARRIERE_PLUS &&
        user?.currentPath !== UserPath.PROFESSIONAL)
    ) {
      return { plan: null, entitlements: [] };
    }
    return {
      plan: abonnement.plan,
      entitlements: [...ENTITLEMENT_CATALOGUE[abonnement.plan]],
    };
  }

  async decide(
    userId: string,
    capability: EntitlementCapability,
  ): Promise<EntitlementDecision> {
    // 1. CAPACITÉ INCONNUE — refus, et AUCUNE formule proposée. On ne calcule
    //    pas une recommandation à partir d'un état qu'on vient de déclarer
    //    inconnu : ce serait affirmer savoir ce qui débloque une chose dont on
    //    dit ignorer l'existence.
    if (!this.estConnue(capability)) {
      return this.refus(EntitlementReason.CAPABILITY_UNKNOWN, null);
    }

    // 2. GRATUIT D'ABORD. Le dépôt documente que GRATUIT est l'état par défaut
    //    d'un compte, pas une formule qu'on souscrit : une capacité qui y est
    //    inscrite est ouverte à tous, y compris à qui n'a jamais payé. La
    //    consulter avant tout refus évite de fermer à un non-abonné ce qui lui
    //    est explicitement offert.
    if (this.inclutLaCapacite(SubscriptionPlan.GRATUIT, capability)) {
      return {
        allowed: true,
        reason: EntitlementReason.INCLUDED,
        requiredPlan: null,
      };
    }

    const [abonnement, user] = await Promise.all([
      this.abonnementIndividuelLePlusRecent(userId),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { currentPath: true },
      }),
    ]);

    // La candidature professionnelle est gratuite et reste ouverte par défaut.
    // Elle devient interdite uniquement pendant la couverture d'une formule
    // académique, conformément à la règle métier du produit.
    if (capability === CAPABILITIES.PROFESSIONAL_INTERNSHIP_APPLICATION) {
      const couverture =
        abonnement?.status === SubscriptionStatus.ACTIVE ||
        (abonnement?.status === SubscriptionStatus.CANCELLED &&
          abonnement.currentPeriodEnd != null &&
          abonnement.currentPeriodEnd.getTime() > Date.now());
      if (
        couverture &&
        abonnement?.plan === SubscriptionPlan.CARRIERE_SECURISEE &&
        user?.currentPath === UserPath.ACADEMIC
      ) {
        return this.refus(EntitlementReason.PATH_RESTRICTED, null);
      }
      return {
        allowed: true,
        reason: EntitlementReason.INCLUDED,
        requiredPlan: null,
      };
    }
    const proposition = this.planLePlusPetitIncluant(capability);

    // 3. AUCUN ABONNEMENT — la personne est sur GRATUIT, qui n'inclut pas cette
    //    capacité puisque l'étape 2 l'a déjà écarté.
    if (!abonnement) {
      return this.refus(EntitlementReason.NO_ACTIVE_SUBSCRIPTION, proposition);
    }

    // 4. ABONNEMENT EXPIRÉ. La formule proposée est celle qui était détenue :
    //    c'est celle que la personne reconnaîtra, et le renouvellement est le
    //    geste attendu.
    if (abonnement.status === SubscriptionStatus.EXPIRED) {
      return this.refus(
        EntitlementReason.SUBSCRIPTION_EXPIRED,
        abonnement.plan,
      );
    }

    // 5. UNE RÉSILIATION PREND EFFET À L'ÉCHÉANCE PAYÉE. Elle interdit le
    //    renouvellement, mais ne confisque pas les jours déjà achetés. Le
    //    balayage convertira CANCELLED en EXPIRED à currentPeriodEnd.
    const couvertureEncoreValide =
      abonnement.status === SubscriptionStatus.ACTIVE ||
      (abonnement.status === SubscriptionStatus.CANCELLED &&
        abonnement.currentPeriodEnd != null &&
        abonnement.currentPeriodEnd.getTime() > Date.now());
    if (!couvertureEncoreValide) {
      return this.refus(EntitlementReason.NO_ACTIVE_SUBSCRIPTION, proposition);
    }

    if (
      abonnement.plan === SubscriptionPlan.CARRIERE_SECURISEE &&
      user?.currentPath !== UserPath.ACADEMIC
    ) {
      return this.refus(EntitlementReason.PATH_RESTRICTED, null);
    }
    if (
      abonnement.plan === SubscriptionPlan.CARRIERE_PLUS &&
      user?.currentPath !== UserPath.PROFESSIONAL
    ) {
      return this.refus(EntitlementReason.PATH_RESTRICTED, null);
    }

    // 6. FORMULE ABSENTE DU CATALOGUE — ne peut normalement pas arriver, le
    //    Record étant exhaustif par le type. Si cela survient, c'est que la
    //    donnée en base a devancé le code : on refuse, sans rien proposer.
    if (!ENTITLEMENT_CATALOGUE[abonnement.plan]) {
      return this.refus(EntitlementReason.PLAN_UNKNOWN, null);
    }

    if (this.inclutLaCapacite(abonnement.plan, capability)) {
      return {
        allowed: true,
        reason: EntitlementReason.INCLUDED,
        requiredPlan: null,
      };
    }

    return this.refus(EntitlementReason.NOT_INCLUDED_IN_PLAN, proposition);
  }

  private refus(
    reason: EntitlementReason,
    requiredPlan: SubscriptionPlan | null,
  ): EntitlementDecision {
    return { allowed: false, reason, requiredPlan };
  }

  private estCouvert(
    status: SubscriptionStatus,
    currentPeriodEnd: Date | null,
  ): boolean {
    return (
      status === SubscriptionStatus.ACTIVE ||
      (status === SubscriptionStatus.CANCELLED &&
        currentPeriodEnd != null &&
        currentPeriodEnd.getTime() > Date.now())
    );
  }

  private estConnue(capability: EntitlementCapability): boolean {
    return Object.keys(CAPABILITIES).includes(capability);
  }

  private inclutLaCapacite(
    plan: SubscriptionPlan,
    capability: EntitlementCapability,
  ): boolean {
    return ENTITLEMENT_CATALOGUE[plan].includes(capability);
  }

  private planLePlusPetitIncluant(
    capability: EntitlementCapability,
  ): SubscriptionPlan | null {
    for (const plan of ORDRE_DE_PROPOSITION) {
      if (this.inclutLaCapacite(plan, capability)) return plan;
    }
    return null;
  }

  // Le plus récent, et non « l'actif » : c'est ce qui permet de distinguer un
  // compte qui n'a jamais souscrit d'un compte dont l'abonnement a expiré. Les
  // deux se voient refuser la capacité, mais pas pour la même raison, et
  // l'interface n'a pas le même geste à proposer.
  private async abonnementIndividuelLePlusRecent(userId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        beneficiaryUserId: userId,
        plan: { in: [...INDIVIDUAL_PLANS] },
      },
      orderBy: { createdAt: 'desc' },
      select: { plan: true, status: true, currentPeriodEnd: true },
    });
  }
}
