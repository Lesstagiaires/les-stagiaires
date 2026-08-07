import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { PartnershipsController } from './partnerships.controller';
import { PartnershipTypesService } from './partnership-types.service';
import { PartnershipsService } from './partnerships.service';

// Aucune file de traitement planifié ici, volontairement : un partenariat ne change
// jamais d'état sous l'effet du temps qui passe (décision du promoteur du 2026-07-31).
// Toute transition résulte d'une action humaine tracée.
//
// OpportunitiesModule est importé pour OrganizationAccessService : point unique
// d'autorisation des actions au nom d'une organisation, jamais une vérification
// `ownerId === userId` réécrite ici (CLAUDE.md §3).
@Module({
  imports: [NotificationsModule, OpportunitiesModule],
  controllers: [PartnershipsController],
  providers: [PartnershipsService, PartnershipTypesService],
  exports: [PartnershipsService],
})
export class PartnershipsModule {}
