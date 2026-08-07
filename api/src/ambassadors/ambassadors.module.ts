import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AmbassadorPolicyService } from './ambassador-policy.service';
import {
  AmbassadorSweepProcessor,
  AmbassadorSweepScheduler,
} from './ambassador-sweep.processor';
import { AmbassadorsController } from './ambassadors.controller';
import { AttributionKitService } from './attribution-kit.service';
import { AttributionLinkController } from './attribution-link.controller';
import { AmbassadorsService } from './ambassadors.service';
import { CommissionCapsService } from './commission-caps.service';
import { CommissionRulesService } from './commission-rules.service';
import { CommissionsService } from './commissions.service';
import { FraudDetectionService } from './fraud-detection.service';
import { IdentityDocumentsService } from './identity-documents.service';
import { PaymentDetailsService } from './payment-details.service';
import { TrainingAdminService } from './training-admin.service';
import { TrainingService } from './training.service';
import { PayoutsService } from './payouts.service';
import { PortfolioService } from './portfolio.service';
import { ReconciliationService } from './reconciliation.service';
import { WalletService } from './wallet.service';

// CommissionsService et AmbassadorsService sont exportés : le module Abonnements
// appelle le premier à la confirmation d'un paiement, et l'inscription appelle le
// second pour rattacher un filleul. Aucun de ces appelants ne connaît le barème ni
// le grand livre — ils signalent un fait, ce module en tire les conséquences.
@Module({
  imports: [
    NotificationsModule,
    BullModule.registerQueue({ name: 'ambassador-sweep' }),
  ],
  controllers: [AmbassadorsController, AttributionLinkController],
  providers: [
    AmbassadorsService,
    AmbassadorPolicyService,
    CommissionRulesService,
    CommissionCapsService,
    CommissionsService,
    PortfolioService,
    WalletService,
    ReconciliationService,
    FraudDetectionService,
    IdentityDocumentsService,
    PaymentDetailsService,
    TrainingService,
    TrainingAdminService,
    AttributionKitService,
    PayoutsService,
    AmbassadorSweepProcessor,
    AmbassadorSweepScheduler,
  ],
  exports: [AmbassadorsService, CommissionsService],
})
export class AmbassadorsModule {}
