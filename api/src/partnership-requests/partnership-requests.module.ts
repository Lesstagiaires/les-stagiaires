import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PartnershipRequestsController } from './partnership-requests.controller';
import { PartnershipRequestsService } from './partnership-requests.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PartnershipRequestsController],
  providers: [PartnershipRequestsService],
  exports: [PartnershipRequestsService],
})
export class PartnershipRequestsModule {}
