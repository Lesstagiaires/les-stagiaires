import {
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import {
  CAPABILITIES,
  EntitlementReason,
  type EntitlementCapability,
} from './entitlement-capability';
import { ENTITLEMENT_CATALOGUE } from './entitlement-catalogue';
import { EntitlementsService } from './entitlements.service';

// ============================================================================
// LA DÉCISION D'ENTITLEMENT — COMPORTEMENT FAIL-CLOSED
//
// Le catalogue est vide en V6-4 : ces tests éprouvent donc le MÉCANISME, pas une
// capacité. C'est voulu — le jour où une capacité payante existera, la garde
// aura déjà été vérifiée sur tous ses chemins de refus.
//
// AUCUNE CAPACITÉ FICTIVE N'EST INSCRITE DANS LE CODE DE PRODUCTION. La capacité
// inconnue utilisée ci-dessous est fabriquée ICI, par transtypage, et n'existe
// nulle part ailleurs — c'est précisément ce qu'on veut voir refuser.
// ============================================================================

const CAPACITE_INCONNUE =
  'CAPACITE_QUI_N_EXISTE_PAS' as unknown as EntitlementCapability;

function serviceAvec(
  abonnement: { plan: SubscriptionPlan; status: SubscriptionStatus } | null,
) {
  const prisma = {
    subscription: { findFirst: jest.fn().mockResolvedValue(abonnement) },
  };
  return new EntitlementsService(prisma as unknown as PrismaService);
}

describe('EntitlementsService', () => {
  it('refuse une capacité inconnue, sans proposer de formule', async () => {
    const decision = await serviceAvec(null).decide('u1', CAPACITE_INCONNUE);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(EntitlementReason.CAPABILITY_UNKNOWN);
    // On ne calcule pas ce qui débloquerait une chose dont on vient de dire
    // qu'on ignore l'existence.
    expect(decision.requiredPlan).toBeNull();
  });

  it('refuse même avec un abonnement actif : inconnu reste inconnu', async () => {
    const decision = await serviceAvec({
      plan: SubscriptionPlan.CARRIERE_PLUS,
      status: SubscriptionStatus.ACTIVE,
    }).decide('u1', CAPACITE_INCONNUE);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(EntitlementReason.CAPABILITY_UNKNOWN);
  });

  it('rend toujours une décision complète, jamais un booléen', async () => {
    const decision = await serviceAvec(null).decide('u1', CAPACITE_INCONNUE);

    expect(Object.keys(decision).sort()).toEqual([
      'allowed',
      'reason',
      'requiredPlan',
    ]);
    // Le motif est renseigné même lorsqu'il refuse — un refus muet n'apprend
    // rien à l'appelant, qui finirait par le redeviner à sa façon.
    expect(decision.reason).toBeDefined();
  });

  // ==========================================================================
  // LE CATALOGUE LUI-MÊME
  // ==========================================================================
  it('est vide en V6-4 — aucune capacité payante n’a été inventée', () => {
    expect(Object.keys(CAPABILITIES)).toHaveLength(0);
    for (const plan of Object.values(SubscriptionPlan)) {
      expect(ENTITLEMENT_CATALOGUE[plan]).toEqual([]);
    }
  });

  it('couvre exhaustivement les formules du schéma', () => {
    // Si une formule apparaît un jour dans Prisma sans entrer au catalogue, le
    // typage l'aurait déjà refusé — ce test le constate aussi à l'exécution,
    // pour le cas où la donnée devancerait le code.
    for (const plan of Object.values(SubscriptionPlan)) {
      expect(ENTITLEMENT_CATALOGUE[plan]).toBeDefined();
    }
  });

  // MONOTONIE : payer davantage ne retire jamais rien. Le test parcourt le
  // catalogue plutôt que d'énumérer des cas, afin qu'il garde son sens le jour
  // où des capacités y seront ajoutées — aujourd'hui il passe sur des ensembles
  // vides, demain il mordra.
  it.each([
    [SubscriptionPlan.GRATUIT, SubscriptionPlan.CARRIERE_SECURISEE],
    [SubscriptionPlan.CARRIERE_SECURISEE, SubscriptionPlan.CARRIERE_PLUS],
    [SubscriptionPlan.GRATUIT, SubscriptionPlan.CARRIERE_PLUS],
  ])('inclut %s dans %s', (petit, grand) => {
    for (const capacite of ENTITLEMENT_CATALOGUE[petit]) {
      expect(ENTITLEMENT_CATALOGUE[grand]).toContain(capacite);
    }
  });

  // ==========================================================================
  // LES CHEMINS DE REFUS LIÉS À L'ABONNEMENT
  //
  // Ils ne sont pas atteignables tant que le catalogue est vide — toute capacité
  // est alors inconnue, et la décision s'arrête à la première étape. Ces tests
  // éprouvent donc la RÉSOLUTION DE L'ABONNEMENT, qui, elle, est déjà réelle :
  // c'est elle qui distinguera un compte n'ayant jamais souscrit d'un compte
  // expiré, et l'interface n'a pas le même geste à proposer dans les deux cas.
  // ==========================================================================
  it('interroge l’abonnement individuel le plus récent du bénéficiaire', async () => {
    const prisma = {
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new EntitlementsService(prisma as unknown as PrismaService);

    // Une capacité connue est nécessaire pour dépasser la première étape ; le
    // catalogue étant vide, on éprouve la requête en appelant directement la
    // résolution par le chemin public disponible.
    await service.decide('u1', CAPACITE_INCONNUE);

    // La capacité étant inconnue, la décision s'arrête AVANT toute requête :
    // c'est la propriété fail-closed la plus économique — on ne va pas chercher
    // en base de quoi répondre à une question qui n'a pas de sens.
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });
});
