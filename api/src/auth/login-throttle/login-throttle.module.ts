import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuditService } from '../../audit/audit.service';
import { budgetsDepuis, LOGIN_THROTTLE } from './login-throttle.interface';
import { MemoryLoginThrottle } from './memory-login-throttle';
import { RedisLoginThrottle } from './redis-login-throttle';

// ============================================================================
// Le même idiome que SMS, stockage, paiement, antivirus et e-mail : une
// interface, deux implémentations, le choix par variable d'environnement.
//
// `memory` est le défaut, parce qu'il permet de lancer l'API sans Redis en
// développement. C'est aussi pourquoi `production-readiness.ts` le REFUSE en
// production : un défaut commode doit être un défaut bruyant là où il ne
// convient pas.
// ============================================================================
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: LOGIN_THROTTLE,
      inject: [ConfigService, AuditService],
      useFactory: (config: ConfigService, audit: AuditService) => {
        const fournisseur = config.get<string>(
          'LOGIN_THROTTLE_PROVIDER',
          'memory',
        );
        // Les deux implémentations reçoivent LES MÊMES budgets. Les laisser
        // diverger ferait qu'une panne Redis changerait la politique de
        // sécurité en même temps que le support de comptage.
        const budgets = budgetsDepuis(config);
        return fournisseur === 'redis'
          ? new RedisLoginThrottle(config, audit, budgets)
          : new MemoryLoginThrottle(budgets);
      },
    },
  ],
  exports: [LOGIN_THROTTLE],
})
export class LoginThrottleModule {}
