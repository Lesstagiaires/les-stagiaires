import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class ParentalConsentSweepScheduler implements OnModuleInit {
  constructor(
    @InjectQueue('parental-consent-sweep') private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'daily-sweep',
      { every: 24 * 60 * 60 * 1000 },
      { name: 'sweep' },
    );
  }
}
