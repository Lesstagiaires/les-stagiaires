import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AmbassadorsModule } from '../ambassadors/ambassadors.module';
import { AuthModule } from '../auth/auth.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { PaymentsModule as PaymentGatewayModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SubscriptionExpiryProcessor } from './subscription-expiry.processor';
import { SubscriptionNoticesService } from './subscription-notices.service';
import { SubscriptionExpiryScheduler } from './subscription-expiry.scheduler';
import { SubscriptionPricingService } from './subscription-pricing.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [
    AuthModule,
    AmbassadorsModule,
    OpportunitiesModule,
    PaymentGatewayModule,
    NotificationsModule,
    BullModule.registerQueue({ name: 'subscription-expiry' }),
  ],
  controllers: [SubscriptionsController, PaymentsController],
  providers: [
    SubscriptionsService,
    PaymentsService,
    SubscriptionPricingService,
    SubscriptionExpiryProcessor,
    SubscriptionExpiryScheduler,
    SubscriptionNoticesService,
  ],
})
export class SubscriptionsModule {}
