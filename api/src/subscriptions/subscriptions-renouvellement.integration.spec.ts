import 'dotenv/config';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import { Client } from 'pg';
import {
  AccountStatus,
  PaymentStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import type { CommissionsService } from '../ambassadors/commissions.service';
import { AuditService } from '../audit/audit.service';
import type { MinorPolicyService } from '../auth/minor-policy.service';
import { PaymentNotSentError } from '../payments/payment-gateway-provider.interface';
import type { OrganizationAccessService } from '../opportunities/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import type { SubscriptionNoticesService } from './subscription-notices.service';
import type { SubscriptionPricingService } from './subscription-pricing.service';
import { SubscriptionsService } from './subscriptions.service';

// ============================================================================
// P1-2 — RENOUVELLEMENT, ÉPROUVÉ SUR UNE BASE RÉELLE
//
// POURQUOI CE FICHIER EXISTE, EN PLUS DES TESTS UNITAIRES.
// Les doubles couvrent les règles d'éligibilité et l'arithmétique de période.
// Trois propriétés leur échappent par nature, et ce sont celles qui engagent
// l'argent de l'abonné :
//
//   1. LA CHAÎNE COMPLÈTE — demande, encaissement, confirmation par webhook,
//      prolongation effective. Aucun mock ne prouve qu'elle se referme.
//   2. LA CONSERVATION DES JOURS PAYÉS, lue dans la colonne elle-même.
//   3. LA COURSE : deux demandes simultanées franchissent ensemble la garde
//      applicative. Seul l'index partiel les départage — et le scénario
//      ci-dessous le DÉMONTRE plutôt que de l'affirmer.
//
// Le renouvellement ne crée aucune Subscription (arbitrage D-1) : la garantie
// P1-1 n'est donc jamais sollicitée. Un scénario le vérifie explicitement, car
// c'est précisément la propriété qui permet à P1-2 de ne pas affaiblir P1-1.
//
// LA BASE EST JETABLE : la base de développement n'est jamais écrite.
// ============================================================================

const BASE_JETABLE = 'stagiaires_it_abonnement_renouvellement';
const INDEX = 'Payment_un_seul_en_vol_par_abonnement_key';
const SECRET = 'secret-de-test';
const JOUR = 24 * 60 * 60 * 1000;

function urlDe(base: string): string {
  const u = new URL(process.env.DATABASE_URL_ORIGINE!);
  u.pathname = '/' + base;
  return u.href;
}

async function sqlAdmin(requete: string): Promise<void> {
  const c = new Client({ connectionString: urlDe('postgres') });
  await c.connect();
  try {
    await c.query(requete);
  } finally {
    await c.end();
  }
}

async function definitionDeLIndex(): Promise<string | null> {
  const c = new Client({ connectionString: urlDe(BASE_JETABLE) });
  await c.connect();
  try {
    const r = await c.query<{ indexdef: string }>(
      'SELECT indexdef FROM pg_indexes WHERE indexname = $1',
      [INDEX],
    );
    return r.rows[0]?.indexdef ?? null;
  } finally {
    await c.end();
  }
}

describe('P1-2 : renouvellement (base réelle)', () => {
  let prisma: PrismaService;
  let service: SubscriptionsService;
  let payments: PaymentsService;
  let userId: string;
  let organizationId: string;
  let echecPasserelle: Error | null = null;

  // Confirme le dernier encaissement en vol, par le SEUL chemin qui existe :
  // le webhook du prestataire. Aucun test de ce fichier n'écrit `CONFIRMED`
  // directement — ce serait court-circuiter la règle que l'on prétend vérifier.
  async function confirmerParWebhook(reference: string): Promise<void> {
    await payments.handleProviderCallback('simulated', SECRET, {
      providerReference: reference,
      status: 'CONFIRMED',
    });
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL absente : ce test d'intégration a besoin d'un PostgreSQL " +
          "joignable (docker compose up -d) et d'un fichier api/.env.",
      );
    }
    process.env.DATABASE_URL_ORIGINE = process.env.DATABASE_URL;

    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE_JETABLE}"`);
    await sqlAdmin(`CREATE DATABASE "${BASE_JETABLE}"`);

    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: urlDe(BASE_JETABLE) },
      stdio: 'pipe',
    });

    process.env.DATABASE_URL = urlDe(BASE_JETABLE);
    prisma = new PrismaService();

    let reference = 0;
    const config = new ConfigService({
      PAYMENT_GATEWAY_PROVIDER: 'simulated',
      PAYMENT_WEBHOOK_SECRET_SIMULATED: SECRET,
    });
    const audit = new AuditService(prisma);

    service = new SubscriptionsService(
      prisma,
      config,
      audit,
      {} as unknown as MinorPolicyService,
      // Le contrôle d'habilitation d'organisation a ses propres tests ; ici il
      // laisse passer, pour que le scénario porte sur le renouvellement.
      {
        assertCanManage: () => Promise.resolve(),
        assertCanManageBilling: () => Promise.resolve(),
      } as unknown as OrganizationAccessService,
      {
        resolve: () => ({ amountMinor: 100000, currency: 'XAF' }),
      } as unknown as SubscriptionPricingService,
      {
        // Passerelle pilotable : `echecPasserelle` permet d'éprouver les deux
        // branches d'échec sur une base RÉELLE. La passerelle simulée du dépôt
        // ne lève jamais — sans ce levier, le défaut corrigé ici resterait
        // indémontrable autrement que par des doubles.
        initiate: () => {
          if (echecPasserelle) return Promise.reject(echecPasserelle);
          return Promise.resolve({
            providerReference: `SIM-${++reference}`,
            instructions: 'Paiement simulé.',
          });
        },
      },
    );

    payments = new PaymentsService(
      prisma,
      config,
      audit,
      // P1-2 ne touche pas aux commissions : le double le rend visible, et un
      // appel réel ferait dépendre ce fichier d'un module hors périmètre.
      {
        onPaymentConfirmed: () => Promise.resolve(),
      } as unknown as CommissionsService,
      // V6-5 — même raisonnement que pour les commissions ci-dessus : P1-2
      // éprouve la mécanique de reconduction, pas les avis. Le double rend
      // visible qu'aucun avis n'entre dans ce que ce fichier démontre — et si
      // l'émission venait un jour peser sur la reconduction, ces scénarios ne
      // le masqueraient pas, ils resteraient muets sur le sujet.
      {
        signalerPaiementConfirme: () => Promise.resolve(),
      } as unknown as SubscriptionNoticesService,
    );

    const user = await prisma.user.create({
      data: {
        phone: '+237690005151',
        password: 'sans-objet-pour-ce-test',
        firstName: 'Bilal',
        countryOfResidence: 'CM',
        status: AccountStatus.ACTIVE,
      },
    });
    userId = user.id;

    const organization = await prisma.organization.create({
      data: {
        ownerId: userId,
        name: 'Entreprise de test',
        country: 'CM',
        city: 'Douala',
        // Exigée depuis V6-3 : un déclencheur PostgreSQL refuse toute nouvelle
        // organisation sans catégorie. Purement descriptive — la formule
        // d'abonnement continue de dériver de la FAMILLE (`type`), et ce test
        // vérifie précisément que cette dérivation n'a pas bougé.
        category: 'COMPANY',
      },
    });
    organizationId = organization.id;
  }, 180_000);

  beforeEach(async () => {
    echecPasserelle = null;
    await prisma.payment.deleteMany({});
    await prisma.subscription.deleteMany({});
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    process.env.DATABASE_URL = process.env.DATABASE_URL_ORIGINE;
    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE_JETABLE}"`);
  }, 60_000);

  // Fabrique un abonnement dans l'état voulu, sans passer par le service : les
  // scénarios portent sur le RENOUVELLEMENT, pas sur la souscription initiale
  // qui a ses propres tests.
  async function abonnementExistant(overrides: {
    status: SubscriptionStatus;
    currentPeriodEnd: Date | null;
    beneficiaryUserId?: string | null;
    beneficiaryOrganizationId?: string | null;
    plan?: SubscriptionPlan;
  }) {
    return prisma.subscription.create({
      data: {
        plan: overrides.plan ?? SubscriptionPlan.CARRIERE_SECURISEE,
        billingCycle: 'ANNUAL',
        amountMinor: 100000,
        currency: 'XAF',
        countryCode: 'CM',
        status: overrides.status,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        currentPeriodEnd: overrides.currentPeriodEnd,
        beneficiaryUserId:
          overrides.beneficiaryUserId === undefined
            ? userId
            : overrides.beneficiaryUserId,
        beneficiaryOrganizationId: overrides.beneficiaryOrganizationId ?? null,
      },
    });
  }

  it("l'index partiel existe et son prédicat n'a pas bougé", async () => {
    const definition = await definitionDeLIndex();

    expect(definition).not.toBeNull();
    expect(definition).toContain('CREATE UNIQUE INDEX');
    expect(definition).toContain('"subscriptionId"');
    expect(definition).toContain('INITIATED');
    // Un paiement terminé libère la place : ces états n'ont rien à faire dans
    // le prédicat, sans quoi un abonnement ne pourrait jamais être renouvelé.
    expect(definition).not.toContain('CONFIRMED');
    expect(definition).not.toContain('FAILED');
  });

  // LE SCÉNARIO CENTRAL : aucun jour payé n'est perdu.
  it('ajoute la nouvelle période aux jours restants lors d’une reconduction anticipée', async () => {
    const finEnCours = new Date(Date.now() + 10 * JOUR);
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: finEnCours,
    });

    const demande = await service.renew(userId, abonnement.id);
    await confirmerParWebhook(demande.payment.providerReference!);

    const apres = await prisma.subscription.findUniqueOrThrow({
      where: { id: abonnement.id },
    });
    const attendu = new Date(finEnCours);
    attendu.setFullYear(attendu.getFullYear() + 1);

    expect(apres.currentPeriodEnd?.getTime()).toBe(attendu.getTime());
    expect(apres.status).toBe(SubscriptionStatus.ACTIVE);
    // La relation n'a pas recommencé : seule la période a bougé.
    expect(apres.startedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  }, 60_000);

  it('assure la continuité quand la reconduction tombe à l’échéance', async () => {
    const finEnCours = new Date(Date.now() + 60_000);
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: finEnCours,
    });

    const demande = await service.renew(userId, abonnement.id);
    await confirmerParWebhook(demande.payment.providerReference!);

    const apres = await prisma.subscription.findUniqueOrThrow({
      where: { id: abonnement.id },
    });
    const attendu = new Date(finEnCours);
    attendu.setFullYear(attendu.getFullYear() + 1);
    expect(apres.currentPeriodEnd?.getTime()).toBe(attendu.getTime());
  }, 60_000);

  it('repart de maintenant après expiration, sans crédit rétroactif', async () => {
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.EXPIRED,
      currentPeriodEnd: new Date(Date.now() - 200 * JOUR),
    });

    const demande = await service.renew(userId, abonnement.id);
    await confirmerParWebhook(demande.payment.providerReference!);

    const apres = await prisma.subscription.findUniqueOrThrow({
      where: { id: abonnement.id },
    });
    const dansUnAn = new Date();
    dansUnAn.setFullYear(dansUnAn.getFullYear() + 1);

    expect(apres.status).toBe(SubscriptionStatus.ACTIVE);
    expect(
      Math.abs(apres.currentPeriodEnd!.getTime() - dansUnAn.getTime()),
    ).toBeLessThan(60_000);
  }, 60_000);

  // LA PROPRIÉTÉ QUI PROTÈGE P1-1 : aucune seconde ligne n'est créée, donc la
  // garantie d'unicité n'est ni sollicitée ni contournée.
  it('ne crée jamais de seconde Subscription', async () => {
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 10 * JOUR),
    });

    const demande = await service.renew(userId, abonnement.id);
    await confirmerParWebhook(demande.payment.providerReference!);

    const lignes = await prisma.subscription.findMany({
      where: { beneficiaryUserId: userId },
    });
    expect(lignes).toHaveLength(1);
    expect(lignes[0].id).toBe(abonnement.id);
    // Deux encaissements, une seule ligne d'abonnement.
    const encaissements = await prisma.payment.count({
      where: { subscriptionId: abonnement.id },
    });
    expect(encaissements).toBe(1);
  }, 60_000);

  // LA COURSE. Les deux appels franchissent ensemble la garde applicative :
  // aucun ne voit l'encaissement de l'autre, puisque aucun n'est encore écrit.
  it('deux demandes simultanées ne produisent qu’un seul encaissement', async () => {
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 10 * JOUR),
    });

    const issues = await Promise.allSettled([
      service.renew(userId, abonnement.id),
      service.renew(userId, abonnement.id),
    ]);

    const reussies = issues.filter((i) => i.status === 'fulfilled');
    const refusees = issues.filter((i) => i.status === 'rejected');
    expect(reussies).toHaveLength(1);
    expect(refusees).toHaveLength(1);

    const enVol = await prisma.payment.count({
      where: {
        subscriptionId: abonnement.id,
        status: PaymentStatus.INITIATED,
      },
    });
    expect(enVol).toBe(1);
  }, 60_000);

  // UN RENOUVELLEMENT QUI ÉCHOUE NE CONFISQUE RIEN.
  it('laisse la couverture en cours intacte quand le paiement échoue', async () => {
    const finEnCours = new Date(Date.now() + 10 * JOUR);
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: finEnCours,
    });

    const demande = await service.renew(userId, abonnement.id);
    await payments.handleProviderCallback('simulated', SECRET, {
      providerReference: demande.payment.providerReference!,
      status: 'FAILED',
    });

    const apres = await prisma.subscription.findUniqueOrThrow({
      where: { id: abonnement.id },
    });
    expect(apres.status).toBe(SubscriptionStatus.ACTIVE);
    expect(apres.currentPeriodEnd?.getTime()).toBe(finEnCours.getTime());

    // Et l'échec libère la place : une nouvelle tentative est possible
    // immédiatement, sans quoi l'abonné resterait enfermé.
    await expect(service.renew(userId, abonnement.id)).resolves.toBeDefined();
  }, 60_000);

  it('refuse une reconduction hors de la fenêtre de trente jours', async () => {
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 90 * JOUR),
    });

    await expect(service.renew(userId, abonnement.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(
      await prisma.payment.count({ where: { subscriptionId: abonnement.id } }),
    ).toBe(0);
  }, 60_000);

  // DÉCISION EXPLICITE, pas un oubli : un abonnement résilié ne se renouvelle
  // pas. L'ancrage `max(currentPeriodEnd, now)` recréditerait sinon des jours
  // que le titulaire avait lui-même abandonnés. Le chemin correct est une
  // nouvelle souscription — que P1-1 autorise, CANCELLED ne bloquant pas la
  // place.
  it('refuse de renouveler un abonnement résilié', async () => {
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.CANCELLED,
      currentPeriodEnd: new Date(Date.now() + 10 * JOUR),
    });

    await expect(service.renew(userId, abonnement.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      await prisma.payment.count({ where: { subscriptionId: abonnement.id } }),
    ).toBe(0);
  }, 60_000);

  // ==========================================================================
  // ÉCHEC DE LA PASSERELLE — LE DÉFAUT RELEVÉ EN CLÔTURE DE P1-2
  //
  // Avant correction, une exception de `gateway.initiate` abandonnait un
  // Payment INITIATED que RIEN ne pouvait plus clore : le webhook cherche par
  // `providerReference`, resté nul ; aucun balayage ne ramasse les paiements en
  // vol ; `cancel()` ne les touche pas. L'index partiel bloquait alors tout
  // renouvellement futur, définitivement, sur un abonnement pourtant à jour.
  // ==========================================================================
  it('libère le verrou quand la passerelle certifie que rien n’est parti', async () => {
    const finEnCours = new Date(Date.now() + 10 * JOUR);
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: finEnCours,
    });

    echecPasserelle = new PaymentNotSentError();
    await expect(service.renew(userId, abonnement.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    // Le paiement est clos, donc hors du prédicat de l'index.
    const enVol = await prisma.payment.count({
      where: {
        subscriptionId: abonnement.id,
        status: PaymentStatus.INITIATED,
      },
    });
    expect(enVol).toBe(0);

    // L'abonnement n'a rien perdu : ni statut, ni jour payé.
    const apres = await prisma.subscription.findUniqueOrThrow({
      where: { id: abonnement.id },
    });
    expect(apres.status).toBe(SubscriptionStatus.ACTIVE);
    expect(apres.currentPeriodEnd?.getTime()).toBe(finEnCours.getTime());

    // ET LA PROPRIÉTÉ QUI COMPTE : une nouvelle tentative aboutit, tout de
    // suite. C'est exactement ce qui était impossible avant la correction.
    echecPasserelle = null;
    const reprise = await service.renew(userId, abonnement.id);
    await confirmerParWebhook(reprise.payment.providerReference!);

    const final = await prisma.subscription.findUniqueOrThrow({
      where: { id: abonnement.id },
    });
    const attendu = new Date(finEnCours);
    attendu.setFullYear(attendu.getFullYear() + 1);
    expect(final.currentPeriodEnd?.getTime()).toBe(attendu.getTime());
  }, 60_000);

  // LE CAS INVERSE, ET IL EST DÉLIBÉRÉ : quand le résultat est inconnu, le
  // verrou TIENT. Libérer ici autoriserait une seconde tentative alors que le
  // payeur a peut-être déjà été débité. La sécurité financière passe avant le
  // confort de la reprise.
  it('maintient le verrou quand le résultat externe est inconnu', async () => {
    const finEnCours = new Date(Date.now() + 10 * JOUR);
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: finEnCours,
    });

    echecPasserelle = new Error('ETIMEDOUT');
    await expect(service.renew(userId, abonnement.id)).rejects.toBeInstanceOf(
      ConflictException,
    );

    // Le paiement reste en vol : il n'est PAS déclaré échoué à tort.
    const enVol = await prisma.payment.findMany({
      where: { subscriptionId: abonnement.id },
    });
    expect(enVol).toHaveLength(1);
    expect(enVol[0].status).toBe(PaymentStatus.INITIATED);

    // L'abonnement reste intact, là encore.
    const apres = await prisma.subscription.findUniqueOrThrow({
      where: { id: abonnement.id },
    });
    expect(apres.status).toBe(SubscriptionStatus.ACTIVE);
    expect(apres.currentPeriodEnd?.getTime()).toBe(finEnCours.getTime());

    // Et toute relance est refusée — aucun second débit possible.
    echecPasserelle = null;
    await expect(service.renew(userId, abonnement.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      await prisma.payment.count({ where: { subscriptionId: abonnement.id } }),
    ).toBe(1);
  }, 60_000);

  // D-4 : les organisations empruntent le MÊME mécanisme, sans logique
  // parallèle. Le scénario le vérifie de bout en bout.
  it('renouvelle un abonnement d’organisation par le même chemin', async () => {
    const abonnement = await abonnementExistant({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 5 * JOUR),
      beneficiaryUserId: null,
      beneficiaryOrganizationId: organizationId,
      plan: SubscriptionPlan.BUSINESS,
    });

    const demande = await service.renew(userId, abonnement.id);
    await confirmerParWebhook(demande.payment.providerReference!);

    const apres = await prisma.subscription.findUniqueOrThrow({
      where: { id: abonnement.id },
    });
    expect(apres.status).toBe(SubscriptionStatus.ACTIVE);
    expect(apres.currentPeriodEnd!.getTime()).toBeGreaterThan(
      Date.now() + 300 * JOUR,
    );
  }, 60_000);
});
