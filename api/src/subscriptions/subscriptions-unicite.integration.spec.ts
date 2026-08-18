import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import { Client } from 'pg';
import {
  AccountStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import type { MinorPolicyService } from '../auth/minor-policy.service';
import type { OrganizationAccessService } from '../opportunities/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type { SubscriptionPricingService } from './subscription-pricing.service';
import { SubscriptionsService } from './subscriptions.service';

// ============================================================================
// P1-1 — UN SEUL ABONNEMENT INDIVIDUEL ACTIF, ÉPROUVÉ SUR UNE BASE RÉELLE
//
// POURQUOI CE FICHIER EXISTE, EN PLUS DU TEST UNITAIRE.
// `subscriptions.service.spec.ts` couvre la garde applicative sur des doubles.
// Il ne peut rien dire de ce qui compte ici : la garde LIT PUIS ÉCRIT, et deux
// requêtes simultanées la franchissent ensemble sans jamais se voir. Ce n'est
// pas une hypothèse — le premier scénario ci-dessous le DÉMONTRE : les deux
// appels passent la vérification applicative, et c'est l'index partiel qui
// tranche.
//
// Le second scénario surveille l'index lui-même. Prisma ne sait pas exprimer un
// index PARTIEL dans schema.prisma : il est créé en SQL dans la migration
// 20260818090000, et Prisma ne le gère donc pas. Un futur `migrate dev`
// pourrait vouloir le supprimer. Vérifier ici sa DÉFINITION EXACTE fait de cette
// dérive une erreur bruyante plutôt qu'un silence.
//
// LA BASE EST JETABLE : la base de développement n'est jamais écrite.
// ============================================================================

const BASE_JETABLE = 'stagiaires_it_abonnement_unicite';
const INDEX = 'Subscription_beneficiaire_individuel_actif_key';

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

describe('P1-1 : un seul abonnement individuel actif (base réelle)', () => {
  let prisma: PrismaService;
  let service: SubscriptionsService;
  let userId: string;

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

    // Les vraies migrations sur une base vierge : si celle de P1-1 cessait de
    // s'appliquer, ce test échouerait ici, avant tout scénario.
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: urlDe(BASE_JETABLE) },
      stdio: 'pipe',
    });

    process.env.DATABASE_URL = urlDe(BASE_JETABLE);
    prisma = new PrismaService();

    let reference = 0;
    service = new SubscriptionsService(
      prisma,
      new ConfigService({ PAYMENT_GATEWAY_PROVIDER: 'simulated' }),
      new AuditService(prisma),
      // Jamais appelé par une auto-souscription (CLAUDE.md §6) — présent parce
      // que le constructeur l'exige, pas parce que le scénario s'en sert.
      {} as unknown as MinorPolicyService,
      {} as unknown as OrganizationAccessService,
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

    const user = await prisma.user.create({
      data: {
        phone: '+237690004242',
        password: 'sans-objet-pour-ce-test',
        firstName: 'Awa',
        countryOfResidence: 'CM',
        status: AccountStatus.ACTIVE,
      },
    });
    userId = user.id;
  }, 180_000);

  // Chaque scénario repart d'une table vide. Sans cela, un test qui échoue
  // laisse ses lignes derrière lui et fait tomber les suivants pour une raison
  // qui n'est pas la leur — constaté pendant le sabotage de l'index.
  beforeEach(async () => {
    await prisma.payment.deleteMany({});
    await prisma.subscription.deleteMany({});
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    process.env.DATABASE_URL = process.env.DATABASE_URL_ORIGINE;
    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE_JETABLE}"`);
  }, 60_000);

  it("l'index partiel existe et son prédicat n'a pas bougé", async () => {
    const definition = await definitionDeLIndex();

    expect(definition).not.toBeNull();
    // Chaque fragment est vérifié séparément : une comparaison de chaîne
    // entière casserait au moindre reformatage de PostgreSQL, une vérification
    // trop lâche laisserait passer un prédicat élargi. Ce sont les termes qui
    // portent la règle métier qui sont épinglés.
    expect(definition).toContain('CREATE UNIQUE INDEX');
    expect(definition).toContain('"beneficiaryUserId"');
    expect(definition).toContain('IS NOT NULL');
    expect(definition).toContain('CARRIERE_SECURISEE');
    expect(definition).toContain('CARRIERE_PLUS');
    expect(definition).toContain('ACTIVE');
    expect(definition).toContain('PENDING_PAYMENT');
    // Les statuts qui doivent rester libres n'ont rien à faire dans le prédicat.
    expect(definition).not.toContain('PAYMENT_FAILED');
    expect(definition).not.toContain('EXPIRED');
    expect(definition).not.toContain('CANCELLED');
  });

  // CE TEST EST CELUI QUI PROUVE LA GARANTIE STRUCTURELLE.
  //
  // Il écrit DIRECTEMENT en base, sans passer par le service : c'est la seule
  // façon de vérifier que la protection tient même si la garde applicative est
  // contournée — migration manuelle, script d'exploitation, futur chemin de code
  // qui oublierait la garde. Vérifié par sabotage : en supprimant l'index, ce
  // test échoue ; en le rétablissant, il passe.
  it("l'index refuse une seconde ligne occupante, même écrite hors du service", async () => {
    const commun = {
      plan: 'CARRIERE_SECURISEE' as const,
      billingCycle: 'ANNUAL' as const,
      amountMinor: 100000,
      currency: 'XAF',
      countryCode: 'CM',
      beneficiaryUserId: userId,
    };

    await prisma.subscription.create({
      data: { ...commun, status: SubscriptionStatus.ACTIVE },
    });

    await expect(
      prisma.subscription.create({
        data: { ...commun, status: SubscriptionStatus.PENDING_PAYMENT },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Et le prédicat n'est pas trop large : les statuts libérés le sont
    // réellement, sans quoi le renouvellement (P1-2) serait impossible.
    for (const libre of [
      SubscriptionStatus.PAYMENT_FAILED,
      SubscriptionStatus.EXPIRED,
      SubscriptionStatus.CANCELLED,
    ]) {
      await expect(
        prisma.subscription.create({ data: { ...commun, status: libre } }),
      ).resolves.toMatchObject({ status: libre });
    }

    await prisma.subscription.deleteMany({
      where: { beneficiaryUserId: userId },
    });
  }, 60_000);

  // LA RÈGLE V5 « PARCOURS → PARCOURS PRO = UPGRADE, JAMAIS UN SECOND ABONNEMENT ».
  //
  // Le test précédent insère deux fois la MÊME formule. Il laissait donc reposer
  // sur un raisonnement — l'index est clé sur `beneficiaryUserId` seul — le cas
  // qui porte réellement la règle métier : deux formules DIFFÉRENTES pour le même
  // bénéficiaire. Lacune relevée en revue contradictoire, fermée ici par une
  // mesure plutôt que par une déduction.
  it("un PARCOURS actif empêche l'ouverture d'un PARCOURS PRO pour le même compte", async () => {
    const commun = {
      billingCycle: 'ANNUAL' as const,
      amountMinor: 100000,
      currency: 'XAF',
      countryCode: 'CM',
      beneficiaryUserId: userId,
      status: SubscriptionStatus.ACTIVE,
    };

    await prisma.subscription.create({
      data: { ...commun, plan: SubscriptionPlan.CARRIERE_SECURISEE },
    });

    // Écriture DIRECTE en base : la garde applicative n'est pas dans le chemin,
    // le refus ne peut donc venir que de l'index partiel.
    await expect(
      prisma.subscription.create({
        data: { ...commun, plan: SubscriptionPlan.CARRIERE_PLUS },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const restantes = await prisma.subscription.findMany({
      where: { beneficiaryUserId: userId },
    });
    expect(restantes).toHaveLength(1);
    expect(restantes[0].plan).toBe(SubscriptionPlan.CARRIERE_SECURISEE);
  }, 60_000);

  // La clause `beneficiaryUserId IS NOT NULL` du prédicat, éprouvée plutôt que
  // supposée : sans elle, deux abonnements d'organisation entreraient en
  // collision sur une clé nulle commune.
  it("ne concerne jamais les abonnements d'organisation", async () => {
    const commun = {
      plan: SubscriptionPlan.BUSINESS,
      billingCycle: 'ANNUAL' as const,
      amountMinor: 5000000,
      currency: 'XAF',
      countryCode: 'CM',
      status: SubscriptionStatus.ACTIVE,
      // Aucun bénéficiaire individuel : c'est ce seul point qui décide de
      // l'indexation. Le rattachement à une organisation n'entre pas dans le
      // prédicat, il est donc volontairement laissé de côté ici.
      beneficiaryUserId: null,
    };

    await prisma.subscription.create({ data: commun });
    await prisma.subscription.create({ data: commun });

    const organisationnels = await prisma.subscription.findMany({
      where: { beneficiaryUserId: null },
    });
    expect(organisationnels).toHaveLength(2);
  }, 60_000);

  // Comportement de bout en bout. ATTENTION À CE QU'IL PROUVE : mesuré, les deux
  // appels se sérialisent en pratique et c'est la garde applicative qui refuse
  // le second — le sabotage de l'index laisse ce test vert. Il vaut donc comme
  // test de COMPORTEMENT (un seul abonnement, un seul paiement, un conflit
  // métier), jamais comme preuve de la garantie contre les accès concurrents :
  // celle-ci est portée par le test précédent.
  it('deux souscriptions simultanées ne produisent qu’un seul abonnement et un seul paiement', async () => {
    const issues = await Promise.allSettled([
      service.subscribeSelf(userId, {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      }),
      service.subscribeSelf(userId, {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      }),
    ]);

    const reussies = issues.filter((i) => i.status === 'fulfilled');
    const rejetees = issues.filter((i) => i.status === 'rejected');

    expect(reussies).toHaveLength(1);
    expect(rejetees).toHaveLength(1);

    // Le perdant reçoit un conflit métier, jamais une erreur serveur brute.
    expect(rejetees[0].reason).toBeInstanceOf(ConflictException);

    const abonnements = await prisma.subscription.findMany({
      where: { beneficiaryUserId: userId },
    });
    expect(abonnements).toHaveLength(1);
    expect(abonnements[0].status).toBe(SubscriptionStatus.PENDING_PAYMENT);

    // L'état des paiements compte autant que celui des abonnements : un
    // Payment orphelin signifierait qu'un encaissement peut encore survenir.
    const paiements = await prisma.payment.findMany({
      where: { subscriptionId: abonnements[0].id },
    });
    expect(paiements).toHaveLength(1);

    const tousPaiements = await prisma.payment.count();
    expect(tousPaiements).toBe(1);
  }, 60_000);
});
