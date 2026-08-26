import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  FILE_DE_SUPERVISION,
  SweepSupervisionService,
} from './sweep-supervision.service';

// NIVEAU 1 — la surveillance pendant que l'API tourne.
//
// Cadence horaire : la file la plus rapide du dépôt tourne à l'heure, et une
// tolérance de K × every ne se juge utilement qu'à un rythme au moins équivalent.
//
// UNE PANNE DE LA SUPERVISION ELLE-MÊME reste sous la limite fondamentale : ce
// processeur ne peut pas signaler son propre arrêt. Il est découvert comme
// n'importe quelle autre file, et son silence sera constaté au prochain réveil.
@Processor(FILE_DE_SUPERVISION)
export class SupervisionSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(SupervisionSweepProcessor.name);

  constructor(private readonly supervision: SweepSupervisionService) {
    super();
  }

  async process(): Promise<void> {
    const signales = await this.supervision.surveiller();
    if (signales > 0) {
      this.logger.warn(`${signales} incident(s) de balayage signalé(s).`);
    }
  }
}

// Le planificateur vit dans le même fichier que son processeur, comme
// `ambassador-sweep.processor.ts` — les deux moitiés d'un même mécanisme se
// lisent mieux ensemble qu'à deux endroits.
@Injectable()
export class SupervisionSweepScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(FILE_DE_SUPERVISION) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'hourly-sweep',
      { every: 60 * 60 * 1000 },
      { name: 'sweep' },
    );
  }
}
