import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CommissionsService } from './commissions.service';
import { PortfolioService } from './portfolio.service';
import { FraudDetectionService } from './fraud-detection.service';
import { ReconciliationService } from './reconciliation.service';

// Un seul balayage quotidien pour les deux échéances du programme :
//   - la maturation des commissions dont la période de sécurité est écoulée ;
//   - le compte à rebours des portefeuilles (alertes à 9 et 11 mois, libération à 12).
//
// Le portefeuille est traité APRÈS les commissions, à dessein : si les deux
// opérations concernent la même journée, mieux vaut avoir rendu exigible ce qui est
// dû avant d'annoncer à l'ambassadeur qu'il perd une entreprise.
@Processor('ambassador-sweep')
export class AmbassadorSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(AmbassadorSweepProcessor.name);

  constructor(
    private readonly commissions: CommissionsService,
    private readonly portfolio: PortfolioService,
    private readonly reconciliation: ReconciliationService,
    private readonly fraud: FraudDetectionService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const matured = await this.commissions.matureSecurityPeriods();
    const { expired, warned } = await this.portfolio.runDailySweep();

    // La réconciliation vient EN DERNIER : elle contrôle l'état laissé par les
    // traitements précédents. La lancer d'abord validerait un état périmé.
    const { checked, divergent } = await this.reconciliation.runSweep();

    // L'antifraude vient APRÈS tout le reste : elle observe l'état une fois les
    // traitements du jour passés. Elle ne corrige rien et ne bloque rien — elle
    // constate et alerte, comme la réconciliation.
    const fraude = await this.fraud.runSweep();

    this.logger.log(
      `Balayage ambassadeurs : ${matured} commission(s) devenue(s) exigible(s), ` +
        `${warned} alerte(s) de portefeuille, ${expired} rattachement(s) libéré(s), ` +
        `${checked} portefeuille(s) réconcilié(s) dont ${divergent.length} en écart, ` +
        `${fraude.raised} alerte(s) antifraude.`,
    );
  }
}

@Injectable()
export class AmbassadorSweepScheduler implements OnModuleInit {
  constructor(@InjectQueue('ambassador-sweep') private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'daily-sweep',
      { every: 24 * 60 * 60 * 1000 },
      { name: 'sweep' },
    );
  }
}
