import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { SweepIncidentKind } from '../../generated/prisma/enums';
import type { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { createTemporaryPostgres } from '../test-support/temporary-postgres';
import { SweepSupervisionService } from './sweep-supervision.service';
import { identiteRetard } from './sweep-supervision.types';

// ============================================================================
// LA SUPERVISION, ÉPROUVÉE CONTRE REDIS ET POSTGRESQL RÉELS
//
// POURQUOI CE FICHIER EN PLUS DU TEST UNITAIRE. Le test unitaire éprouve les
// identités et le seuil — des fonctions pures. Il ne peut rien dire de ce qui
// compte ici : que la découverte trouve une file dont le code a disparu, qu'un
// index unique tranche entre deux superviseurs, et qu'une reprise concurrente
// n'envoie pas deux alertes.
//
// ISOLATION. PostgreSQL : une base jetable, jamais celle de développement.
// Redis : la base d'index 15, vidée avant et après — les onze files réelles
// vivent sur l'index par défaut et ne sont ni lues ni touchées.
// ============================================================================

const BASE_JETABLE = 'stagiaires_it_supervision';
const REDIS_INDEX_TEST = '15';
const HEURE = 60 * 60 * 1000;

function urlRedisTest(): string {
  const u = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  u.pathname = '/' + REDIS_INDEX_TEST;
  return u.href;
}

describe('Supervision des balayages (Redis et PostgreSQL réels)', () => {
  let prisma: PrismaService;
  let database: Awaited<ReturnType<typeof createTemporaryPostgres>>;
  let fileDeSupervision: Queue;
  // Un client à part pour la MISE EN SCÈNE. `IRedisClient`, le type que BullMQ
  // expose, ne déclare que les commandes dont BullMQ se sert — ni `zadd`, ni
  // `flushdb`. Passer par lui compilerait mal ; il n'a pas à porter les besoins
  // d'un test.
  let redis: IORedis;
  const connexion = { url: urlRedisTest() };

  // DEUX SUPERVISEURS SONT DEUX PROCESSUS, DONC DEUX CONNEXIONS.
  //
  // Mesuré : en partageant une seule instance de PrismaService, les requêtes des
  // deux superviseurs se sérialisent sur la même connexion et la course ne se
  // produit jamais. Le test passait alors même en retirant la revendication
  // atomique — il ne prouvait rien. Chaque superviseur reçoit donc sa propre
  // connexion, comme deux processus en auraient.
  function superviseur(connexionPropre?: PrismaService) {
    const notifications = {
      notifyAdmins: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SweepSupervisionService(
      fileDeSupervision,
      connexionPropre ?? prisma,
      notifications as unknown as NotificationsService,
    );
    return { service, notifications };
  }

  // Fabrique une file avec son planificateur, puis recule son échéance pour
  // simuler un retard — plutôt que d'attendre trois heures.
  async function fileEnRetard(
    nom: string,
    every: number,
    retardMs: number,
  ): Promise<{ queue: Queue; next: number }> {
    const q = new Queue(nom, { connection: connexion });
    await q.upsertJobScheduler('daily-sweep', { every }, { name: 'sweep' });
    const next = Date.now() - retardMs;
    await redis.zadd(`bull:${nom}:repeat`, String(next), 'daily-sweep');
    return { queue: q, next };
  }

  beforeAll(async () => {
    database = await createTemporaryPostgres(BASE_JETABLE);
    prisma = database.prisma;

    fileDeSupervision = new Queue('supervision-sweep', {
      connection: connexion,
    });
    redis = new IORedis(urlRedisTest(), { maxRetriesPerRequest: null });
    // L'index 15 est réservé aux tests : on le vide pour partir d'un Redis vierge
    // et pour ne rien laisser derrière. Les onze files réelles vivent sur l'index
    // par défaut et ne sont jamais touchées.
    await redis.flushdb();
  }, 180_000);

  beforeEach(async () => {
    await prisma.sweepIncident.deleteMany({});
    await redis.flushdb();
  });

  afterAll(async () => {
    try {
      await redis?.flushdb();
      await redis?.quit();
      await fileDeSupervision?.close();
    } finally {
      await database?.close();
    }
  }, 60_000);

  // ==========================================================================
  // DÉCOUVERTE
  // ==========================================================================
  it('découvre les files par Redis, sans aucune liste écrite à la main', async () => {
    const { queue } = await fileEnRetard('file-inventee', 24 * HEURE, 0);
    const { service } = superviseur();

    const trouvees = await service.decouvrirLesFiles();

    // Le nom n'apparaît nulle part dans le code de production : il ne peut avoir
    // été trouvé que par l'observation de Redis.
    expect(trouvees).toContain('file-inventee');
    await queue.close();
  }, 60_000);

  // LE CAS QUI A MOTIVÉ CE CHOIX. Une file dont le code a disparu garde son
  // planificateur dans Redis. Une liste codée en dur ne la verrait jamais —
  // c'est précisément celle qu'il faut voir.
  it('voit une file présente dans Redis mais consommée par personne', async () => {
    const { queue } = await fileEnRetard(
      'file-orpheline',
      24 * HEURE,
      30 * 24 * HEURE,
    );
    const { service, notifications } = superviseur();

    await service.surveiller();

    const incidents = await prisma.sweepIncident.findMany({
      where: { queueName: 'file-orpheline' },
    });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].kind).toBe(SweepIncidentKind.RETARD);
    expect(notifications.notifyAdmins).toHaveBeenCalledTimes(1);
    await queue.close();
  }, 60_000);

  // ==========================================================================
  // SEUIL
  // ==========================================================================
  it('ne signale rien tant que le retard reste dans la tolérance', async () => {
    const { queue } = await fileEnRetard('file-ponctuelle', HEURE, 2 * HEURE);
    const { service, notifications } = superviseur();

    await service.surveiller();

    expect(await prisma.sweepIncident.count()).toBe(0);
    expect(notifications.notifyAdmins).not.toHaveBeenCalled();
    await queue.close();
  }, 60_000);

  it('signale un retard au-delà de la tolérance', async () => {
    const { queue, next } = await fileEnRetard(
      'file-tardive',
      HEURE,
      5 * HEURE,
    );
    const { service } = superviseur();

    await service.surveiller();

    const incident = await prisma.sweepIncident.findFirstOrThrow({
      where: { queueName: 'file-tardive' },
    });
    expect(incident.episodeKey).toBe(identiteRetard('daily-sweep', next));
    await queue.close();
  }, 60_000);

  // ==========================================================================
  // ÉCHEC D'UN JOB
  // ==========================================================================
  it('signale un job de balayage échoué', async () => {
    const q = new Queue('file-qui-echoue', { connection: connexion });
    await q.add('sweep', {}, { attempts: 1 });
    const worker = new Worker(
      'file-qui-echoue',
      () => {
        throw new Error('panne simulée du balayage');
      },
      { connection: connexion },
    );
    await new Promise<void>((resolve) =>
      worker.once('failed', () => resolve()),
    );
    await worker.close();

    const { service, notifications } = superviseur();
    await service.surveiller();

    const incidents = await prisma.sweepIncident.findMany({
      where: { queueName: 'file-qui-echoue', kind: SweepIncidentKind.ECHEC },
    });
    expect(incidents).toHaveLength(1);
    expect(notifications.notifyAdmins).toHaveBeenCalledTimes(1);
    await q.close();
  }, 60_000);

  // ==========================================================================
  // IDEMPOTENCE ET CONCURRENCE
  // ==========================================================================
  it('ne signale pas deux fois le même épisode à deux passages successifs', async () => {
    const { queue } = await fileEnRetard('file-repetee', HEURE, 10 * HEURE);
    const { service, notifications } = superviseur();

    await service.surveiller();
    await service.surveiller();

    expect(await prisma.sweepIncident.count()).toBe(1);
    expect(notifications.notifyAdmins).toHaveBeenCalledTimes(1);
    await queue.close();
  }, 60_000);

  // C'EST L'INDEX UNIQUE QUI TRANCHE, JAMAIS LE CODE.
  it('ne laisse pas deux superviseurs concurrents ouvrir deux incidents', async () => {
    const { queue } = await fileEnRetard('file-concurrente', HEURE, 10 * HEURE);
    const prismaB = new PrismaService(database.url);
    const a = superviseur();
    const b = superviseur(prismaB);

    try {
      await Promise.all([a.service.surveiller(), b.service.surveiller()]);
    } finally {
      await prismaB.$disconnect();
    }

    expect(await prisma.sweepIncident.count()).toBe(1);
    const envois =
      a.notifications.notifyAdmins.mock.calls.length +
      b.notifications.notifyAdmins.mock.calls.length;
    expect(envois).toBe(1);
    await queue.close();
  }, 60_000);

  // LE TEST EXIGÉ EXPRESSÉMENT : la création unique de l'incident ne suffit PAS
  // à démontrer qu'une seule notification part. Un incident retenu mais non
  // notifié est repris — et deux superviseurs pourraient le reprendre ensemble.
  it('ne laisse pas deux superviseurs reprendre le même incident non notifié', async () => {
    await prisma.sweepIncident.create({
      data: {
        queueName: 'file-en-souffrance',
        kind: SweepIncidentKind.RETARD,
        episodeKey: 'daily-sweep:1',
        // L'alerte n'est jamais partie : c'est l'état laissé par un processus
        // mort entre la retenue de l'incident et l'envoi.
        notifiedAt: null,
      },
    });
    // LA COURSE EST IMPOSÉE, PAS ESPÉRÉE.
    //
    // Deux tentatives précédentes sont restées vertes en retirant la
    // revendication : `Promise.all` seul ne produit pas l'entrelacement voulu,
    // même avec deux connexions distinctes — le premier superviseur termine
    // avant que le second n'écrive, et le doublon ne se manifeste jamais.
    //
    // La propriété à démontrer est précise : les DEUX lectures doivent précéder
    // les DEUX écritures, car c'est là, et seulement là, que la revendication
    // tranche. On retient donc chaque `updateMany` jusqu'à ce que les deux
    // soient arrivés — l'ordre du reste appartient à PostgreSQL.
    const prismaB = new PrismaService(database.url);
    const a = superviseur();
    const b = superviseur(prismaB);

    let arrives = 0;
    let ouvrirLaPorte!: () => void;
    const porte = new Promise<void>((resoudre) => {
      ouvrirLaPorte = resoudre;
    });
    // Vue étroite du seul appel qu'on retient. Le type généré par Prisma est
    // générique et rend un `PrismaPromise` : l'envelopper proprement demanderait
    // plus de contorsions que la mise en scène n'en vaut. On confine donc
    // l'imprécision à cette interface de deux lignes.
    type MiseAJour = (args: never) => Promise<{ count: number }>;
    const originaux = [prisma, prismaB].map((client) => {
      const modele = client.sweepIncident as unknown as {
        updateMany: MiseAJour;
      };
      const original = modele.updateMany;
      modele.updateMany = async (args: never) => {
        arrives += 1;
        if (arrives === 2) ouvrirLaPorte();
        await porte;
        return original(args);
      };
      return { modele, original };
    });

    try {
      await Promise.all([
        a.service.reprendreLesNonNotifies(),
        b.service.reprendreLesNonNotifies(),
      ]);
    } finally {
      // La connexion partagée sert aux autres scénarios : elle doit repartir
      // intacte.
      for (const { modele, original } of originaux) {
        modele.updateMany = original;
      }
      await prismaB.$disconnect();
    }

    const envois =
      a.notifications.notifyAdmins.mock.calls.length +
      b.notifications.notifyAdmins.mock.calls.length;
    expect(envois).toBe(1);

    const incident = await prisma.sweepIncident.findFirstOrThrow({
      where: { queueName: 'file-en-souffrance' },
    });
    expect(incident.notifiedAt).not.toBeNull();
    expect(incident.notifyAttempts).toBe(1);
  }, 60_000);

  it('reprend une alerte que personne n’avait envoyée', async () => {
    await prisma.sweepIncident.create({
      data: {
        queueName: 'file-oubliee',
        kind: SweepIncidentKind.ECHEC,
        episodeKey: 'job-abandonne',
        notifiedAt: null,
      },
    });
    const { service, notifications } = superviseur();

    await service.reprendreLesNonNotifies();

    expect(notifications.notifyAdmins).toHaveBeenCalledTimes(1);
    const incident = await prisma.sweepIncident.findFirstOrThrow({
      where: { queueName: 'file-oubliee' },
    });
    expect(incident.notifiedAt).not.toBeNull();
  }, 60_000);

  // ==========================================================================
  // REPRISE PUIS RECHUTE
  // ==========================================================================
  it('rouvre un épisode quand la file retombe en panne après reprise', async () => {
    const { queue } = await fileEnRetard('file-rechute', HEURE, 10 * HEURE);
    const { service, notifications } = superviseur();
    await service.surveiller();
    expect(notifications.notifyAdmins).toHaveBeenCalledTimes(1);

    // La file repart : l'échéance est replanifiée. L'ancienne identité n'est
    // plus productible — l'épisode est clos sans qu'aucun état n'ait été écrit.
    const nouveauNext = Date.now() - 20 * HEURE;
    await redis.zadd(
      'bull:file-rechute:repeat',
      String(nouveauNext),
      'daily-sweep',
    );

    await service.surveiller();

    expect(notifications.notifyAdmins).toHaveBeenCalledTimes(2);
    expect(await prisma.sweepIncident.count()).toBe(2);
    await queue.close();
  }, 60_000);

  // ==========================================================================
  // LE CONSTAT AU RÉVEIL
  // ==========================================================================
  it('agrège onze files silencieuses en une seule notification', async () => {
    const files: Queue[] = [];
    for (let i = 0; i < 11; i += 1) {
      const { queue } = await fileEnRetard(
        `file-muette-`,
        24 * HEURE,
        14 * 24 * HEURE,
      );
      files.push(queue);
    }
    const { service, notifications } = superviseur();

    await service.constaterAuReveil();

    // UNE alerte, pas onze. C'est exactement l'état mesuré le 2026-08-25.
    expect(notifications.notifyAdmins).toHaveBeenCalledTimes(1);
    const incidents = await prisma.sweepIncident.findMany({
      where: { kind: SweepIncidentKind.REVEIL },
    });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].queueName).toBe('*');
    await Promise.all(files.map((f) => f.close()));
  }, 120_000);

  it('ne réveille rien quand toutes les files sont à l’heure', async () => {
    const { queue } = await fileEnRetard('file-saine', 24 * HEURE, HEURE);
    const { service, notifications } = superviseur();

    await service.constaterAuReveil();

    expect(notifications.notifyAdmins).not.toHaveBeenCalled();
    expect(await prisma.sweepIncident.count()).toBe(0);
    await queue.close();
  }, 60_000);

  it('ne notifie qu’une fois si deux instances démarrent ensemble', async () => {
    const { queue } = await fileEnRetard(
      'file-double-demarrage',
      24 * HEURE,
      10 * 24 * HEURE,
    );
    const a = superviseur();
    const b = superviseur();

    await Promise.all([
      a.service.constaterAuReveil(),
      b.service.constaterAuReveil(),
    ]);

    const envois =
      a.notifications.notifyAdmins.mock.calls.length +
      b.notifications.notifyAdmins.mock.calls.length;
    expect(envois).toBe(1);
    await queue.close();
  }, 60_000);

  // ==========================================================================
  // CE QUE LA SUPERVISION NE FAIT JAMAIS
  // ==========================================================================
  it('n’écrit dans aucune file et ne relance aucun job', async () => {
    const { queue } = await fileEnRetard('file-intacte', HEURE, 10 * HEURE);
    const avant = await queue.getJobCounts();
    const { service } = superviseur();

    await service.surveiller();
    await service.constaterAuReveil();

    expect(await queue.getJobCounts()).toEqual(avant);
    await queue.close();
  }, 60_000);
});
