import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

// Balayage quotidien. Un rappel de début de stage n'a pas besoin d'être plus
// fin : les paliers se comptent en jours, pas en heures.
@Injectable()
export class InternshipStartSweepScheduler implements OnModuleInit {
  constructor(
    @InjectQueue('internship-start-sweep') private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'daily-sweep',
      { every: 24 * 60 * 60 * 1000 },
      { name: 'sweep' },
    );
  }
}
