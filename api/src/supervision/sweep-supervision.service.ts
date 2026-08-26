import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Prisma } from '../../generated/prisma/client';
import { SweepIncidentKind } from '../../generated/prisma/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  estAnormalementEnRetard,
  identiteEchec,
  identiteRetard,
  identiteReveil,
  NOTIFICATION_DE_L_INCIDENT,
  TOUTES_LES_FILES,
} from './sweep-supervision.types';

export const FILE_DE_SUPERVISION = 'supervision-sweep';

export interface EcheanceObservee {
  schedulerId: string;
  every: number;
  next: number;
  enRetard: boolean;
  retardMs: number;
}

// UNE FILE, PAS UNE ÉCHÉANCE. Les deux anomalies sont indépendantes et la
// structure doit le dire : un job échoué se constate même dans une file qui n'a
// aucun planificateur. Une première version liait les deux — un test l'a
// attrapée, une file en échec sans planificateur y restait invisible.
export interface FileObservee {
  queueName: string;
  echeances: EcheanceObservee[];
  echecs: { jobId: string; motif: string }[];
}

function estViolationUnicite(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

// ============================================================================
// RENDRE OBSERVABLE L'ARRÊT D'UN MÉCANISME PÉRIODIQUE
//
// CE QUE CE SERVICE FAIT : il lit Redis, écrit des incidents en PostgreSQL, et
// prévient les administrateurs.
//
// CE QU'IL NE FAIT JAMAIS, ET NE DOIT JAMAIS FAIRE :
//   — il n'écrit dans aucune file, ne relance aucun job, ne purge rien ;
//   — il ne touche à aucune donnée métier, ni à la logique des dix balayages ;
//   — il ne « répare » pas : constater n'est pas corriger, et une supervision
//     qui corrige masque le défaut qu'elle devait rendre visible.
//
// LA LIMITE FONDAMENTALE, ÉCRITE ICI PLUTÔT QU'ENFOUIE. Ce service vit dans le
// processus API. Si ce processus disparaît, il disparaît avec lui : une panne
// TOTALE n'est pas signalée PENDANT qu'elle dure. Elle est seulement constatée
// au prochain démarrage (`supervision-wakeup.service.ts`). Aucun dispositif
// interne ne peut faire mieux — un mort ne signale pas sa mort. Seule une sonde
// externe le pourrait, et elle relève d'une décision d'exploitation distincte.
//
// La supervision se surveille elle-même comme n'importe quelle autre file : elle
// est découverte par le même balayage de Redis. Son propre arrêt tombe donc sous
// la même limite, et sous le même constat au réveil.
// ============================================================================
@Injectable()
export class SweepSupervisionService {
  private readonly logger = new Logger(SweepSupervisionService.name);

  constructor(
    @InjectQueue(FILE_DE_SUPERVISION) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Découverte -------------------------------------------------------------
  //
  // LA RÉALITÉ DE REDIS, JAMAIS UNE LISTE ÉCRITE À LA MAIN. Une liste codée en
  // dur ne verrait que les files auxquelles on a pensé — et manquerait
  // précisément celles qu'il faut voir : celles dont le code a disparu alors que
  // le planificateur, lui, est resté. Mesuré le 2026-08-25 :
  // `partnership-lifecycle` n'est référencée par aucune ligne du dépôt et porte
  // pourtant un planificateur quotidien toujours enregistré.
  //
  // SCAN et non KEYS : KEYS bloque Redis le temps du parcours, ce qu'aucun
  // service de production ne peut se permettre.
  async decouvrirLesFiles(): Promise<string[]> {
    const client = await this.queue.client;
    const trouvees: string[] = [];
    let curseur = '0';
    do {
      // Forme à options de BullMQ 5, et non la forme positionnelle d'ioredis :
      // l'interface `IRedisClient` est volontairement agnostique du client
      // sous-jacent.
      const [suivant, lot] = await client.scan(curseur, {
        MATCH: 'bull:*:meta',
        COUNT: 200,
      });
      curseur = suivant;
      for (const cle of lot) {
        trouvees.push(cle.slice('bull:'.length, -':meta'.length));
      }
    } while (curseur !== '0');
    return trouvees.sort();
  }

  // --- Observation ------------------------------------------------------------
  //
  // La cadence attendue est LUE (`every`), jamais recopiée. La source de vérité
  // reste l'appel `upsertJobScheduler` du module concerné ; la supervision se
  // contente de lire ce que cet appel a écrit.
  async observer(maintenant = Date.now()): Promise<FileObservee[]> {
    const noms = await this.decouvrirLesFiles();
    const observees: FileObservee[] = [];

    for (const queueName of noms) {
      const file = new Queue(queueName, {
        connection: this.queue.opts.connection,
      });
      try {
        const planificateurs = await file.getJobSchedulers();
        const echoues = await file.getFailed(0, 24);
        const echecs = echoues.map((job) => ({
          jobId: String(job.id),
          motif: String(job.failedReason ?? '')
            .split('\n')[0]
            .slice(0, 300),
        }));

        const echeances: EcheanceObservee[] = [];
        for (const p of planificateurs) {
          // SEULS LES PLANIFICATEURS À CADENCE NUMÉRIQUE SONT SUPERVISÉS (SUP-06).
          //
          // `JobSchedulerJson` porte `every` OU `pattern`, jamais les deux : un
          // planificateur défini par expression cron n'a pas de cadence en
          // millisecondes, et la règle « retard > K × every » n'a alors aucun
          // sens. Il est donc VOLONTAIREMENT ignoré ici.
          //
          // Aucun planificateur du dépôt n'est concerné — mesuré le 2026-08-25 :
          // les onze existants utilisent tous `{ every: … }`, aucun n'utilise
          // `pattern`. L'effet est donc nul aujourd'hui.
          //
          // MAIS IL EST SILENCIEUX : le jour où un balayage sera écrit en cron,
          // il ne sera pas supervisé et rien ne le dira. Cette couverture devra
          // être revue à l'introduction du premier planificateur `pattern` —
          // et non par anticipation d'un besoin qui n'existe pas.
          if (typeof p.every !== 'number' || typeof p.next !== 'number') {
            continue;
          }
          echeances.push({
            schedulerId: String(p.key),
            every: p.every,
            next: p.next,
            enRetard: estAnormalementEnRetard(p.next, p.every, maintenant),
            retardMs: maintenant - p.next,
          });
        }

        observees.push({ queueName, echeances, echecs });
      } finally {
        await file.close();
      }
    }
    return observees;
  }

  // --- Niveau 1 : surveillance pendant que l'API tourne -----------------------
  async surveiller(maintenant = Date.now()): Promise<number> {
    // D'ABORD LES INCIDENTS EN SOUFFRANCE. Un incident retenu dont l'alerte
    // n'est jamais partie serait le pire des deux mondes : la panne est connue
    // du système et de personne d'autre.
    await this.reprendreLesNonNotifies();

    let signales = 0;
    for (const file of await this.observer(maintenant)) {
      for (const echeance of file.echeances) {
        if (!echeance.enRetard) continue;
        const ouvert = await this.signaler(
          file.queueName,
          SweepIncidentKind.RETARD,
          identiteRetard(echeance.schedulerId, echeance.next),
          {
            every: echeance.every,
            next: new Date(echeance.next).toISOString(),
            retardHeures: Math.round(echeance.retardMs / 3600000),
          },
        );
        if (ouvert) signales += 1;
      }

      // Indépendant de toute échéance : une file sans planificateur peut avoir
      // des jobs échoués, et ils doivent se voir.
      for (const echec of file.echecs) {
        const ouvert = await this.signaler(
          file.queueName,
          SweepIncidentKind.ECHEC,
          identiteEchec(echec.jobId),
          { jobId: echec.jobId, motif: echec.motif },
        );
        if (ouvert) signales += 1;
      }
    }
    return signales;
  }

  // --- Niveau 2 : le constat au réveil ----------------------------------------
  //
  // UNE SEULE NOTIFICATION, JAMAIS UNE PAR FILE. Mesuré le 2026-08-25 : après
  // quatorze jours sans processus API, ONZE files étaient hors tolérance. Onze
  // alertes pour une seule cause ne sont pas un signal, c'est du bruit — et le
  // bruit fait ignorer les alertes suivantes.
  async constaterAuReveil(maintenant = Date.now()): Promise<boolean> {
    const silencieuses = (await this.observer(maintenant)).flatMap((file) =>
      file.echeances
        .filter((e) => e.enRetard)
        .map((e) => ({
          queueName: file.queueName,
          schedulerId: e.schedulerId,
          next: e.next,
          retardMs: e.retardMs,
        })),
    );
    if (silencieuses.length === 0) return false;

    return this.signaler(
      TOUTES_LES_FILES,
      SweepIncidentKind.REVEIL,
      identiteReveil(silencieuses),
      {
        nombre: silencieuses.length,
        files: silencieuses.map((f) => ({
          file: f.queueName,
          retardHeures: Math.round(f.retardMs / 3600000),
        })),
      },
    );
  }

  // --- Le mécanisme commun -----------------------------------------------------
  //
  // L'INSERTION EST LA GARDE. Deux superviseurs concurrents calculent la même
  // identité — elle ne vient que de faits partagés lus dans Redis — et l'index
  // unique n'en laisse passer qu'un. Ce n'est pas le code qui tranche, c'est la
  // base.
  private async signaler(
    queueName: string,
    kind: SweepIncidentKind,
    episodeKey: string,
    details: Prisma.InputJsonValue,
  ): Promise<boolean> {
    let incidentId: string;
    try {
      const incident = await this.prisma.sweepIncident.create({
        data: { queueName, kind, episodeKey, details },
        select: { id: true },
      });
      incidentId = incident.id;
    } catch (error) {
      if (estViolationUnicite(error)) return false;
      throw error;
    }

    await this.notifierUneSeuleFois(incidentId, queueName, kind, 0);
    return true;
  }

  // LA REVENDICATION DE LA NOTIFICATION, séparée de celle de l'incident.
  //
  // Créer l'incident une seule fois ne suffit PAS à démontrer qu'une seule
  // notification part : un incident retenu mais non notifié est repris, et deux
  // superviseurs pourraient le reprendre ensemble.
  //
  // Le compteur de tentatives sert donc de jeton : `WHERE notifyAttempts = <lu>`
  // ne peut aboutir que pour un seul appelant, PostgreSQL sérialisant les deux
  // mises à jour sur la même ligne. Aucune temporisation n'intervient — donc
  // aucune heuristique, et un incident abandonné en cours de route reste
  // repris au passage suivant.
  private async notifierUneSeuleFois(
    incidentId: string,
    queueName: string,
    kind: SweepIncidentKind,
    tentativesLues: number,
  ): Promise<boolean> {
    const revendication = await this.prisma.sweepIncident.updateMany({
      where: {
        id: incidentId,
        notifiedAt: null,
        notifyAttempts: tentativesLues,
      },
      data: { notifyAttempts: tentativesLues + 1 },
    });
    // Zéro : un autre superviseur a pris cet incident, ou il est déjà notifié.
    if (revendication.count !== 1) return false;

    await this.notifications.notifyAdmins(NOTIFICATION_DE_L_INCIDENT[kind], {
      queueName,
      incidentId,
    });

    // Marqué APRÈS l'envoi. Mourir entre les deux laisse `notifiedAt` nul et le
    // compteur incrémenté : l'incident reste visible, et il sera repris.
    await this.prisma.sweepIncident.update({
      where: { id: incidentId },
      data: { notifiedAt: new Date() },
    });
    return true;
  }

  // Les incidents retenus dont l'alerte n'est jamais partie.
  async reprendreLesNonNotifies(): Promise<number> {
    const enSouffrance = await this.prisma.sweepIncident.findMany({
      where: { notifiedAt: null },
      select: {
        id: true,
        queueName: true,
        kind: true,
        notifyAttempts: true,
      },
      take: 100,
    });

    let reprises = 0;
    for (const incident of enSouffrance) {
      const parti = await this.notifierUneSeuleFois(
        incident.id,
        incident.queueName,
        incident.kind,
        incident.notifyAttempts,
      );
      if (parti) reprises += 1;
    }
    if (reprises > 0) {
      this.logger.log(`${reprises} alerte(s) de supervision reprise(s).`);
    }
    return reprises;
  }
}
