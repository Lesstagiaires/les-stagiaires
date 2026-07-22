import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { OpportunityLifecycleProcessor } from './opportunity-lifecycle.processor';
import { OpportunityLifecycleScheduler } from './opportunity-lifecycle.scheduler';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [
    ReportsModule,
    BullModule.registerQueue({ name: 'opportunity-lifecycle' }),
  ],
  controllers: [
    OrganizationsController,
    // Doivent être enregistrés avant OpportunitiesController : sa route générique
    // GET /opportunities/:id intercepterait sinon GET /opportunities/favorites et
    // GET /opportunities/alerts (Nest résout les routes ambiguës par ordre d'enregistrement).
    FavoritesController,
    AlertsController,
    OpportunitiesController,
  ],
  providers: [
    OrganizationsService,
    OpportunitiesService,
    FavoritesService,
    AlertsService,
    OpportunityLifecycleProcessor,
    OpportunityLifecycleScheduler,
  ],
})
export class OpportunitiesModule {}
