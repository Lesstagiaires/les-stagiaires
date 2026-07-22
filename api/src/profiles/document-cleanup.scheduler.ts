import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class DocumentCleanupScheduler implements OnModuleInit {
  constructor(@InjectQueue('document-cleanup') private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'daily-sweep',
      { every: 24 * 60 * 60 * 1000 },
      { name: 'sweep' },
    );
  }
}
