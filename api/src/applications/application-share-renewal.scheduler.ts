import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class ApplicationShareRenewalScheduler implements OnModuleInit {
  constructor(
    @InjectQueue('application-share-renewal-sweep')
    private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'daily-sweep',
      { every: 24 * 60 * 60 * 1000 },
      { name: 'sweep' },
    );
  }
}
