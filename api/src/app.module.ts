import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApplicationsModule } from './applications/applications.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { DigitalSafeModule } from './digital-safe/digital-safe.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';
import { PartnershipRequestsModule } from './partnership-requests/partnership-requests.module';
import { AmbassadorsModule } from './ambassadors/ambassadors.module';
import { PartnershipsModule } from './partnerships/partnerships.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfilesModule } from './profiles/profiles.module';
import { QueueModule } from './queue/queue.module';
import { ReportsModule } from './reports/reports.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [
    // Les variables d'environnement sont chargées au démarrage et disponibles
    // partout (`isGlobal`) — aucun module n'a à les relire depuis le disque.
    //
    // DEUX FICHIERS, DANS CET ORDRE. `.env.local` l'emporte sur `.env` : le
    // premier trouvé gagne, chez NestJS. C'est ce qui permet d'essayer des
    // identifiants — un compte Africa's Talking, une passerelle de paiement —
    // sans toucher au `.env` de l'équipe, et donc sans risquer de committer un
    // secret en croyant committer un réglage.
    //
    // Les deux sont ignorés par git, comme toute la famille `.env*` sauf
    // `.env.example`.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    CryptoModule,
    AuditModule,
    QueueModule,
    AuthModule,
    ReportsModule,
    ProfilesModule,
    DigitalSafeModule,
    OpportunitiesModule,
    ApplicationsModule,
    NotificationsModule,
    PartnershipRequestsModule,
    PartnershipsModule,
    SubscriptionsModule,
    EntitlementsModule,
    AmbassadorsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
