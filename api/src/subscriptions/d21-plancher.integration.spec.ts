import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  SubscriptionPlan,
  SubscriptionStatus,
  UserPath,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import type { MinorPolicyService } from '../auth/minor-policy.service';
import type { OrganizationAccessService } from '../opportunities/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { createTemporaryPostgres } from '../test-support/temporary-postgres';
import { PLANCHER_PAR_PARCOURS } from './plancher-parcours';
import type { SubscriptionPricingService } from './subscription-pricing.service';
import { SubscriptionsService } from './subscriptions.service';

// ============================================================================
// D-21 — LE PARCOURS FIXE LE PLANCHER D'UNE ACQUISITION, ÉPROUVÉ EN BASE RÉELLE
//
// POURQUOI UNE BASE RÉELLE ET NON DES DOUBLES. La garde lit `currentPath` sur
// l'utilisateur puis décide. Sur un double, on choisirait soi-même ce que la
// lecture rend — et le test ne prouverait plus que la garde interroge le BON
// champ du BON compte. Ici, le parcours est écrit en base par le même chemin que
// V6-1, et c'est lui qui est lu.
//
// CE QUI EST ÉPROUVÉ EN PLUS DU REFUS : que le refus survienne AVANT toute
// écriture. Un refus tardif laisserait un `Subscription` et un `Payment`
// derrière lui — donc un encaissement possible, donc une commission sur une
// vente que la règle interdisait.
//
// ET QUE LES DEUX PORTES D'ACQUISITION SONT COUVERTES. La garde est posée dans
// `createSubscription`, point de passage unique : le parrainage par une
// organisation ne doit pas offrir un contournement de ce que l'auto-souscription
// refuse. C'est le seul scénario qui le démontre.
//
// LA BASE EST JETABLE : la base de développement n'est jamais écrite.
// ============================================================================

const BASE_JETABLE = 'stagiaires_it_d21_plancher';

describe('D-21 : le parcours fixe le plancher d’une acquisition (base réelle)', () => {
  let prisma: PrismaService;
  let database: Awaited<ReturnType<typeof createTemporaryPostgres>>;
  let service: SubscriptionsService;
  let compteur = 0;

  // Un compte par scénario : le parcours est une propriété du COMPTE, et
  // réutiliser le même en le modifiant ferait dépendre chaque test de l'ordre
  // d'exécution des précédents.
  async function compteAvecParcours(
    currentPath: UserPath | null,
  ): Promise<string> {
    const user = await prisma.user.create({
      data: {
        phone: `+23769000${String(1000 + ++compteur).slice(-4)}`,
        password: 'sans-objet-pour-ce-test',
        firstName: 'Awa',
        countryOfResidence: 'CM',
        status: AccountStatus.ACTIVE,
        currentPath,
      },
    });
    return user.id;
  }

  beforeAll(async () => {
    database = await createTemporaryPostgres(BASE_JETABLE);
    prisma = database.prisma;

    let reference = 0;
    service = new SubscriptionsService(
      prisma,
      new ConfigService({ PAYMENT_GATEWAY_PROVIDER: 'simulated' }),
      new AuditService(prisma),
      // Le parrainage passe par la politique mineurs avant d'atteindre D-21.
      // Elle laisse passer ici : ce test porte sur le plancher, et un refus
      // mineur masquerait ce qu'il cherche à établir.
      {
        assertActionAllowed: () => Promise.resolve(),
      } as unknown as MinorPolicyService,
      {
        assertCanManageBilling: () => Promise.resolve(),
      } as unknown as OrganizationAccessService,
      {
        resolve: () => ({ amountMinor: 100000, currency: 'XAF' }),
      } as unknown as SubscriptionPricingService,
      {
        initiate: () =>
          Promise.resolve({
            providerReference: `SIM-${++reference}`,
            instructions: 'Paiement simulé.',
          }),
      },
    );
  }, 180_000);

  afterAll(async () => {
    try {
      // Prisma est la seule ressource spécifique de cette spec.
    } finally {
      await database?.close();
    }
  }, 60_000);

  // ==========================================================================
  // LE REFUS, ET SON ABSENCE D'EFFET DE BORD
  // ==========================================================================
  it('refuse CARRIÈRE SÉCURISÉE à un compte en parcours professionnel', async () => {
    const userId = await compteAvecParcours(UserPath.PROFESSIONAL);

    await expect(
      service.subscribeSelf(userId, {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('refuse sans rien écrire : ni abonnement, ni paiement', async () => {
    const userId = await compteAvecParcours(UserPath.PROFESSIONAL);

    await expect(
      service.subscribeSelf(userId, {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const abonnements = await prisma.subscription.findMany({
      where: { beneficiaryUserId: userId },
    });
    expect(abonnements).toEqual([]);

    // Un `Payment` orphelin signifierait qu'un encaissement reste possible sur
    // une vente que la règle vient d'interdire.
    const paiements = await prisma.payment.findMany({
      where: { subscription: { beneficiaryUserId: userId } },
    });
    expect(paiements).toEqual([]);
  }, 60_000);

  // LE CONTOURNEMENT PAR PARRAINAGE — la raison pour laquelle la garde est dans
  // `createSubscription` et non dans `subscribeSelf`. Sans elle à cet endroit,
  // une organisation ouvrirait à un bénéficiaire la formule que celui-ci ne peut
  // pas acheter lui-même.
  it('refuse aussi lorsque l’organisation parraine la formule', async () => {
    const userId = await compteAvecParcours(UserPath.PROFESSIONAL);
    const organisation = await prisma.organization.create({
      data: {
        name: 'Entreprise du test D-21',
        type: 'ENTREPRISE',
        // V6-3 rend la catégorie obligatoire par déclencheur PostgreSQL :
        // l'omettre ferait échouer l'insertion pour une raison étrangère à D-21.
        category: 'COMPANY',
        country: 'CM',
        city: 'Douala',
        // Le droit du parrain sur la facturation est simulé plus haut : ce test
        // porte sur le plancher, pas sur le RBAC d'organisation.
        ownerId: userId,
      },
    });

    await expect(
      service.subscribeOrgSponsored(userId, organisation.id, userId, {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const abonnements = await prisma.subscription.findMany({
      where: { beneficiaryUserId: userId },
    });
    expect(abonnements).toEqual([]);
  }, 60_000);

  // ==========================================================================
  // CE QUE D-21 LAISSE PASSER
  //
  // Une règle qui restreint doit être éprouvée autant sur ce qu'elle AUTORISE :
  // un plancher trop large fermerait des ventes légitimes sans que rien ne le
  // signale, et une régression de ce genre ne se voit pas en production — elle
  // se compte en abonnements qui n'ont jamais été souscrits.
  // ==========================================================================
  it.each([
    ['parcours professionnel', 'CARRIERE_PLUS', UserPath.PROFESSIONAL],
    ['parcours académique', 'CARRIERE_SECURISEE', UserPath.ACADEMIC],
    // Au-dessus du plancher : la règle fixe un minimum, jamais une formule
    // imposée.
    ['parcours académique', 'CARRIERE_PLUS', UserPath.ACADEMIC],
    // Plancher non arrêté (EMPLOYMENT) : `null` se lit « non décidé ». Aucune
    // restriction n'est inventée en attendant la décision.
    ['parcours emploi', 'CARRIERE_SECURISEE', UserPath.EMPLOYMENT],
  ])(
    'autorise un %s à souscrire %s',
    async (_libelle, plan, parcours) => {
      const userId = await compteAvecParcours(parcours);

      const resultat = await service.subscribeSelf(userId, {
        plan: plan as 'CARRIERE_SECURISEE' | 'CARRIERE_PLUS',
        billingCycle: 'ANNUAL',
      });

      expect(resultat).toBeDefined();
      const abonnements = await prisma.subscription.findMany({
        where: { beneficiaryUserId: userId },
      });
      expect(abonnements).toHaveLength(1);
      expect(abonnements[0].plan).toBe(plan);
    },
    60_000,
  );

  // PARCOURS NON DÉCLARÉ. « Non déclaré » n'autorise pas à deviner une
  // situation, et deviner ici reviendrait à facturer sur une supposition.
  it('n’applique aucun plancher à un compte sans parcours déclaré', async () => {
    const userId = await compteAvecParcours(null);

    await expect(
      service.subscribeSelf(userId, {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      }),
    ).resolves.toBeDefined();
  }, 60_000);

  // ==========================================================================
  // LE DROIT ACQUIS SURVIT AU CHANGEMENT DE PARCOURS
  //
  // Quelqu'un qui a souscrit CARRIÈRE SÉCURISÉE en étant étudiant, puis déclare
  // un parcours professionnel, ne doit pas se voir refuser la reconduction de ce
  // qu'il détient déjà : il n'achète pas une formule, il prolonge la sienne. La
  // garde ne se trouve pas sur ce chemin — ce test le CONSTATE plutôt que de le
  // déduire de l'emplacement du code.
  // ==========================================================================
  it('laisse renouveler une formule détenue avant un changement de parcours', async () => {
    const userId = await compteAvecParcours(UserPath.ACADEMIC);

    const abonnement = await prisma.subscription.create({
      data: {
        plan: SubscriptionPlan.CARRIERE_SECURISEE,
        billingCycle: 'ANNUAL',
        amountMinor: 100000,
        currency: 'XAF',
        countryCode: 'CM',
        beneficiaryUserId: userId,
        status: SubscriptionStatus.EXPIRED,
        currentPeriodEnd: new Date('2026-01-01T00:00:00Z'),
      },
    });

    // Le parcours évolue APRÈS l'acquisition — exactement le cas limite exigé
    // par la charte : la bascule d'un parcours à l'autre en cours d'usage.
    await prisma.user.update({
      where: { id: userId },
      data: { currentPath: UserPath.PROFESSIONAL },
    });

    await expect(service.renew(userId, abonnement.id)).resolves.toBeDefined();
  }, 60_000);

  // ==========================================================================
  // LA TABLE ELLE-MÊME
  // ==========================================================================
  it('couvre exhaustivement les parcours du schéma', () => {
    // Un parcours ajouté demain sans décision de plancher ne compilerait pas —
    // le Record est exhaustif. Ce test le constate aussi à l'exécution, pour le
    // cas où la donnée devancerait le code.
    for (const parcours of Object.values(UserPath)) {
      expect(PLANCHER_PAR_PARCOURS).toHaveProperty(parcours);
    }
  });
});
