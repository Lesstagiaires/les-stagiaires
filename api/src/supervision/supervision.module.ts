import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  SupervisionSweepProcessor,
  SupervisionSweepScheduler,
} from './supervision-sweep.processor';
import { SupervisionWakeupService } from './supervision-wakeup.service';
import {
  FILE_DE_SUPERVISION,
  SweepSupervisionService,
} from './sweep-supervision.service';

// La supervision n'importe AUCUN module métier : elle n'a rien à leur demander.
// Elle lit Redis, écrit en PostgreSQL, et prévient les administrateurs — d'où
// ces trois dépendances et pas une de plus. C'est aussi ce qui garantit qu'aucune
// dépendance circulaire ne peut s'installer entre elle et ce qu'elle surveille.
@Module({
  imports: [
    NotificationsModule,
    BullModule.registerQueue({ name: FILE_DE_SUPERVISION }),
  ],
  providers: [
    SweepSupervisionService,
    SupervisionSweepProcessor,
    SupervisionSweepScheduler,
    SupervisionWakeupService,
  ],
})
export class SupervisionModule {}
