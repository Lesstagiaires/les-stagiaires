import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AmbassadorsModule } from '../ambassadors/ambassadors.module';
import { ReportsModule } from '../reports/reports.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { EstablishmentsController } from './establishments.controller';
import { EstablishmentsService } from './establishments.service';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { NeedRequestsController } from './need-requests.controller';
import { OfferQualityService } from './offer-quality.service';
import { NeedRequestsService } from './need-requests.service';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { RelevanceScoringService } from './relevance-scoring.service';
import { SearchAdminController } from './search-admin.controller';
import { SearchAdminService } from './search-admin.service';
import { OpportunityLifecycleProcessor } from './opportunity-lifecycle.processor';
import { OpportunityLifecycleScheduler } from './opportunity-lifecycle.scheduler';
import { OrganizationAccessService } from './organization-access.service';
import { OrganizationMembersController } from './organization-members.controller';
import { OrganizationMembersService } from './organization-members.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [
    AmbassadorsModule,
    ReportsModule,
    // Plus aucun service de ce module n'envoie de SMS depuis la migration de la
    // politique SMS (2026-08-01) : ils publient un évènement, et NotificationsService
    // choisit le canal.
    NotificationsModule,
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
    // Préfixe /search-admin, distinct de /opportunities : le réglage du moteur
    // ne partage aucun espace de routes avec les offres qu'il classe.
    SearchAdminController,
    OpportunitiesController,
  ],
  providers: [
    OrganizationAccessService,
    OrganizationsService,
    OrganizationMembersService,
    NeedRequestsService,
    EstablishmentsService,
    OpportunitiesService,
    RelevanceScoringService,
    OfferQualityService,
    SearchAdminService,
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
