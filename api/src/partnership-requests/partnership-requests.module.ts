import { Module } from '@nestjs/common';
import { PartnershipRequestsController } from './partnership-requests.controller';
import { PartnershipRequestsService } from './partnership-requests.service';

@Module({
  controllers: [PartnershipRequestsController],
  providers: [PartnershipRequestsService],
  exports: [PartnershipRequestsService],
})
export class PartnershipRequestsModule {}
