import 'dotenv/config';
import { execSync } from 'child_process';
import { Client } from 'pg';
import {
  AccountStatus,
  SubscriptionNoticeType,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import type { MinorPolicyService } from '../auth/minor-policy.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionNoticesService } from './subscription-notices.service';

// ============================================================================
// V6-5 — UN AVIS, UNE FOIS, PAR PÉRIODE — ÉPROUVÉ SUR UNE BASE RÉELLE
//
// POURQUOI CE FICHIER EN PLUS DU TEST UNITAIRE. Le test unitaire éprouve la
// DÉCISION du service sur des doubles ; il ne peut rien dire de ce qui compte
// ici. La garantie n'est pas dans le code : elle est dans deux index uniques
// PARTIELS, que Prisma ne sait pas exprimer et ne gère donc pas. Seule une base
// réelle montre qu'ils existent, qu'ils portent le bon prédicat, et qu'ils
// tranchent quand deux exécutions se présentent ensemble.
//
// LA BASE EST JETABLE : la base de développement n'est jamais écrite.
// ============================================================================

const BASE_JETABLE = 'stagiaires_it_avis_abonnement';
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

async function definitionDeLIndex(nom: string): Promise<string | null> {
  const c = new Client({ connectionString: urlDe(BASE_JETABLE) });
  await c.connect();
  try {
    const r = await c.query<{ indexdef: string }>(
      'SELECT indexdef FROM pg_indexes WHERE indexname = $1',
      [nom],
    );
    return r.rows[0]?.indexdef ?? null;
  } finally {
    await c.end();
  }
}

describe('V6-5 : un avis, une fois, par période (base réelle)', () => {
  let prisma: PrismaService;
  let compteur = 0;

  // Chaque service est un WORKER : même base, doubles distincts. C'est ce qui
  // permet de compter combien d'envois seraient réellement partis.
  function worker(mineur = false) {
    const notifications = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyOrganizationLeadership: jest.fn().mockResolvedValue(undefined),
    };
    const minorPolicy = {
      requiresParentalConsent: jest.fn().mockResolvedValue(mineur),
    };
    const service = new SubscriptionNoticesService(
      prisma,
      notifications as unknown as NotificationsService,
      minorPolicy as unknown as MinorPolicyService,
    );
    return { service, notifications };
  }

  async function abonnement(options: {
    finDePeriode: Date | null;
    cycle?: 'ANNUAL' | 'ONE_TIME';
    statut?: SubscriptionStatus;
  }) {
    const user = await prisma.user.create({
      data: {
        phone: `+23769100${String(1000 + ++compteur).slice(-4)}`,
        password: 'sans-objet-pour-ce-test',
        firstName: 'Awa',
        countryOfResidence: 'CM',
        dateOfBirth: new Date('1995-01-01'),
        status: AccountStatus.ACTIVE,
      },
    });
    return prisma.subscription.create({
      data: {
        plan: SubscriptionPlan.CARRIERE_PLUS,
        billingCycle: options.cycle ?? 'ANNUAL',
        amountMinor: 100000,
        currency: 'XAF',
        countryCode: 'CM',
        beneficiaryUserId: user.id,
        status: options.statut ?? SubscriptionStatus.ACTIVE,
        currentPeriodEnd: options.finDePeriode,
      },
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
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    process.env.DATABASE_URL = process.env.DATABASE_URL_ORIGINE;
    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE_JETABLE}"`);
  }, 60_000);

  // ==========================================================================
  // LES DEUX INDEX, ET LEURS PRÉDICATS EXACTS
  //
  // Prisma ne les gère pas : un futur `migrate dev` pourrait vouloir les
  // supprimer. Épingler leur définition fait de cette dérive une erreur
  // bruyante plutôt qu'un silence.
  // ==========================================================================
  it('porte un index unique par période, et un autre pour l’absence de période', async () => {
    const parPeriode = await definitionDeLIndex(
      'SubscriptionNotice_periode_key',
    );
    expect(parPeriode).toContain('CREATE UNIQUE INDEX');
    expect(parPeriode).toContain('"subscriptionId"');
    expect(parPeriode).toContain('"periodEnd"');
    expect(parPeriode).toContain('IS NOT NULL');

    const sansPeriode = await definitionDeLIndex(
      'SubscriptionNotice_sans_periode_key',
    );
    expect(sansPeriode).toContain('CREATE UNIQUE INDEX');
    expect(sansPeriode).toContain('"subscriptionId"');
    expect(sansPeriode).toContain('IS NULL');
  });

  // CELUI QUI PROUVE LA GARANTIE STRUCTURELLE.
  //
  // Écriture DIRECTE en base, sans passer par le service : c'est la seule façon
  // de vérifier que la protection tient même si la garde applicative est
  // contournée — script d'exploitation, futur chemin de code, migration
  // manuelle.
  it('refuse un second avis pour la même période, même écrit hors du service', async () => {
    const sub = await abonnement({ finDePeriode: new Date('2027-01-01') });
    const commun = {
      subscriptionId: sub.id,
      type: SubscriptionNoticeType.EXPIRING_SOON,
      periodEnd: sub.currentPeriodEnd,
    };

    await prisma.subscriptionNotice.create({ data: commun });
    await expect(
      prisma.subscriptionNotice.create({ data: commun }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Et le prédicat n'est pas trop large : un AUTRE type reste possible sur la
    // même période, sans quoi un abonnement n'aurait droit qu'à un seul avis.
    await expect(
      prisma.subscriptionNotice.create({
        data: { ...commun, type: SubscriptionNoticeType.RENEWAL_WINDOW_OPEN },
      }),
    ).resolves.toBeDefined();
  }, 60_000);

  // ==========================================================================
  // DEUX WORKERS CONCURRENTS
  // ==========================================================================
  it('ne laisse pas deux exécutions simultanées envoyer deux fois', async () => {
    const sub = await abonnement({
      finDePeriode: new Date(Date.now() + 3 * JOUR),
    });
    const a = worker();
    const b = worker();

    await Promise.all([
      a.service.balayerEcheances(new Date()),
      b.service.balayerEcheances(new Date()),
    ]);

    const envois =
      a.notifications.notifyUser.mock.calls.length +
      b.notifications.notifyUser.mock.calls.length;
    expect(envois).toBe(1);

    const avis = await prisma.subscriptionNotice.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(avis).toHaveLength(1);
  }, 60_000);

  it('ne renvoie rien au second passage du balayage', async () => {
    const sub = await abonnement({
      finDePeriode: new Date(Date.now() + 3 * JOUR),
    });
    const { service, notifications } = worker();

    await service.balayerEcheances(new Date());
    await service.balayerEcheances(new Date());

    expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
    expect(
      await prisma.subscriptionNotice.count({
        where: { subscriptionId: sub.id },
      }),
    ).toBe(1);
  }, 60_000);

  // ==========================================================================
  // LE RETARD DU BALAYAGE
  //
  // Mesuré le 2026-08-24 : treize jours sans exécution, faute de processus API
  // vivant. Un réveil ne doit pas rattraper son retard en rafale.
  // ==========================================================================
  it('après un long silence, n’émet qu’un seul avis et non toute la série', async () => {
    const sub = await abonnement({
      finDePeriode: new Date(Date.now() + 3 * JOUR),
    });
    const { service, notifications } = worker();

    await service.balayerEcheances(new Date());

    expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
    const avis = await prisma.subscriptionNotice.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(avis).toHaveLength(1);
    expect(avis[0].type).toBe(SubscriptionNoticeType.EXPIRING_SOON);
  }, 60_000);

  // ==========================================================================
  // LA RECONDUCTION ROUVRE LA PÉRIODE — SANS REMISE À ZÉRO
  //
  // C'est la propriété qui a fait préférer une table à des colonnes horodatées :
  // aucune ligne de code ne remet un marqueur à zéro, et pourtant la nouvelle
  // période retrouve son droit à être signalée.
  // ==========================================================================
  it('rouvre naturellement le droit à un avis quand la période change', async () => {
    const finInitiale = new Date(Date.now() + 3 * JOUR);
    const sub = await abonnement({ finDePeriode: finInitiale });
    const { service, notifications } = worker();

    await service.balayerEcheances(new Date());
    expect(notifications.notifyUser).toHaveBeenCalledTimes(1);

    // Reconduction : la période est prolongée d'un an, puis on revient dans la
    // fenêtre de la NOUVELLE période.
    const nouvelleFin = new Date(Date.now() + 5 * JOUR);
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: nouvelleFin },
    });

    await service.balayerEcheances(new Date());

    expect(notifications.notifyUser).toHaveBeenCalledTimes(2);
    const avis = await prisma.subscriptionNotice.findMany({
      where: { subscriptionId: sub.id },
      orderBy: { claimedAt: 'asc' },
    });
    expect(avis).toHaveLength(2);
    expect(avis.map((a) => a.periodEnd?.toISOString())).toEqual([
      finInitiale.toISOString(),
      nouvelleFin.toISOString(),
    ]);
  }, 60_000);

  // ==========================================================================
  // ONE_TIME
  // ==========================================================================
  it('ne signale aucune échéance à une prestation à l’acte', async () => {
    const sub = await abonnement({ finDePeriode: null, cycle: 'ONE_TIME' });
    const { service, notifications } = worker();

    await service.balayerEcheances(new Date());

    expect(notifications.notifyUser).not.toHaveBeenCalled();
    expect(
      await prisma.subscriptionNotice.count({
        where: { subscriptionId: sub.id },
      }),
    ).toBe(0);
  }, 60_000);

  // L'index « sans période » existe pour ce cas précis : deux NULL n'entrent
  // jamais en collision dans un index ordinaire, et une prestation à l'acte
  // aurait donc pu recevoir autant d'avis d'activation qu'on voulait.
  it('n’active qu’une fois une prestation à l’acte', async () => {
    const sub = await abonnement({ finDePeriode: null, cycle: 'ONE_TIME' });
    const { service, notifications } = worker();

    await service.signalerPaiementConfirme(sub.id, true);
    await service.signalerPaiementConfirme(sub.id, true);

    expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
    expect(
      await prisma.subscriptionNotice.count({
        where: { subscriptionId: sub.id },
      }),
    ).toBe(1);
  }, 60_000);

  // ==========================================================================
  // CE QU'UN AVIS NE FAIT JAMAIS
  // ==========================================================================
  it('ne modifie ni le statut, ni la période, ni aucun droit', async () => {
    const fin = new Date(Date.now() + 3 * JOUR);
    const sub = await abonnement({ finDePeriode: fin });
    const { service } = worker();

    await service.balayerEcheances(new Date());
    await service.signalerFinDeCouverture([sub.id]);

    const apres = await prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(apres.status).toBe(SubscriptionStatus.ACTIVE);
    expect(apres.currentPeriodEnd?.toISOString()).toBe(fin.toISOString());
    expect(apres.cancelledAt).toBeNull();
    expect(apres.plan).toBe(sub.plan);
  }, 60_000);

  // ==========================================================================
  // MINEURS
  // ==========================================================================
  it('ne sollicite pas un mineur, et ne réserve rien à sa place', async () => {
    const sub = await abonnement({
      finDePeriode: new Date(Date.now() + 3 * JOUR),
    });
    const { service, notifications } = worker(true);

    await service.balayerEcheances(new Date());

    expect(notifications.notifyUser).not.toHaveBeenCalled();
    expect(
      await prisma.subscriptionNotice.count({
        where: { subscriptionId: sub.id },
      }),
    ).toBe(0);
  }, 60_000);

  it('informe un mineur de la fin effective de sa couverture', async () => {
    const sub = await abonnement({ finDePeriode: new Date(Date.now() - JOUR) });
    const { service, notifications } = worker(true);

    await service.signalerFinDeCouverture([sub.id]);

    expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
  }, 60_000);
});
