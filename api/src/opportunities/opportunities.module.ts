import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { SmsModule } from '../sms/sms.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { EstablishmentsController } from './establishments.controller';
import { EstablishmentsService } from './establishments.service';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { NeedRequestsController } from './need-requests.controller';
import { NeedRequestsService } from './need-requests.service';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { OpportunityLifecycleProcessor } from './opportunity-lifecycle.processor';
import { OpportunityLifecycleScheduler } from './opportunity-lifecycle.scheduler';
import { OrganizationAccessService } from './organization-access.service';
import { OrganizationMembersController } from './organization-members.controller';
import { OrganizationMembersService } from './organization-members.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [
    ReportsModule,
    SmsModule,
    BullModule.registerQueue({ name: 'opportunity-lifecycle' }),
  ],
  controllers: [
    // OrganizationMembersController déclare des routes littérales
    // (/organizations/invitations, /organizations/partners côté OrganizationsController)
    // qui doivent être enregistrées avant la route générique GET /organizations/:id —
    // même piège que favoris/alertes vs offres (Nest résout par ordre d'enregistrement).
    OrganizationMembersController,
    NeedRequestsController,
    EstablishmentsController,
    OrganizationsController,
    FavoritesController,
    AlertsController,
    OpportunitiesController,
  ],
  providers: [
    OrganizationAccessService,
    OrganizationsService,
    OrganizationMembersService,
    NeedRequestsService,
    EstablishmentsService,
    OpportunitiesService,
    FavoritesService,
    AlertsService,
    OpportunityLifecycleProcessor,
    OpportunityLifecycleScheduler,
  ],
  // OrganizationAccessService est réutilisé par le module Candidatures pour les
  // vérifications d'autorisation côté organisation (FR-ORG-002).
  exports: [OrganizationAccessService],
})
export class OpportunitiesModule {}
