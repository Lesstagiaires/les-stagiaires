import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class SubscriptionExpiryScheduler implements OnModuleInit {
  constructor(
    @InjectQueue('subscription-expiry') private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'hourly-sweep',
      { every: 60 * 60 * 1000 },
      { name: 'sweep' },
    );
  }
}
