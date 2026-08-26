import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SweepSupervisionService } from './sweep-supervision.service';

// ============================================================================
// NIVEAU 2 — LE CONSTAT AU RÉVEIL
//
// CE QU'IL APPORTE, ET CE QU'IL N'APPORTE PAS. Il ne comble pas la limite
// fondamentale : pendant une panne totale, personne n'est prévenu. Il en réduit
// la portée — le silence cesse d'être invisible dès que quelqu'un rallume, et il
// devient DATABLE.
//
// C'est exactement ce qui manquait. L'arrêt de quatorze jours constaté le
// 2026-08-25 n'a été découvert que parce qu'on est allé le chercher : rien, dans
// le système, ne l'aurait jamais dit.
//
// `OnApplicationBootstrap` et non `OnModuleInit` : les planificateurs des dix
// balayages s'enregistrent en `onModuleInit`. Observer avant eux ferait lire un
// Redis à moitié rempli et prendrait un démarrage normal pour une anomalie.
//
// LE CONSTAT NE BLOQUE JAMAIS LE DÉMARRAGE. Une supervision qui empêche l'API de
// monter serait une panne de plus, pas une alerte.
// ============================================================================
@Injectable()
export class SupervisionWakeupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SupervisionWakeupService.name);

  constructor(private readonly supervision: SweepSupervisionService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const signale = await this.supervision.constaterAuReveil();
      if (signale) {
        this.logger.warn(
          'Des balayages étaient silencieux au démarrage — incident de supervision ouvert.',
        );
      }
    } catch (error) {
      this.logger.error(
        'Constat de supervision au démarrage impossible.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
