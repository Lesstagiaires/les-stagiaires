import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationType,
  WalletTransactionType,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

// ============================================================================
// RÉCONCILIATION COMPTABLE
//
// Arbitrage du promoteur du 2026-08-02 : « Le solde affiché dans le portefeuille
// ne doit jamais être considéré comme la seule source de vérité. Le grand livre
// WalletTransaction doit constituer la référence comptable. »
//
// `AmbassadorWallet` est un CACHE DE LECTURE, entretenu par des `increment` /
// `decrement` atomiques. `WalletTransaction` est la VÉRITÉ. Les deux ne peuvent
// diverger que par un bogue — mais un bogue sur de l'argent qui passe des mois
// inaperçu coûte bien plus cher que le balayage qui l'aurait détecté le soir même.
//
// TROIS CONTRÔLES INDÉPENDANTS, parce qu'ils n'attrapent pas les mêmes fautes :
//
//   1. SOLDES RECONSTITUÉS — `reserved` et `paidTotal` sont recalculés depuis les
//      sommes signées du grand livre. Attrape une écriture au cache sans écriture
//      au livre.
//
//   2. DERNIÈRE PHOTOGRAPHIE — chaque écriture enregistre `availableAfterMinor` et
//      `pendingAfterMinor`. Ceux de la DERNIÈRE écriture doivent égaler le cache.
//      Attrape un cache modifié après coup.
//
//   3. CONTINUITÉ — l'écart entre deux photographies successives doit correspondre
//      au montant de l'écriture. Attrape une ligne manquante ou insérée — ce que
//      les deux premiers contrôles laisseraient passer si les erreurs se
//      compensaient.
//
// AUCUNE CORRECTION AUTOMATIQUE. Le service constate et alerte ; il ne « répare »
// jamais un solde. Une correction prend la forme d'une nouvelle écriture
// (`WalletService.adjust`), jamais d'une retouche du cache — sans quoi on
// masquerait la cause au lieu de la traiter.
// ============================================================================

export interface BucketDiscrepancy {
  bucket: 'pending' | 'available' | 'reserved' | 'paidTotal';
  cachedMinor: number;
  expectedMinor: number;
  deltaMinor: number;
}

export interface ContinuityBreak {
  transactionId: string;
  /** Solde attendu d'après l'écriture précédente et le montant de celle-ci. */
  expectedAvailableMinor: number;
  recordedAvailableMinor: number;
}

export interface WalletReconciliation {
  ambassadorId: string;
  walletId: string;
  currency: string;
  transactionCount: number;
  discrepancies: BucketDiscrepancy[];
  continuityBreaks: ContinuityBreak[];
  balanced: boolean;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // Réconcilie un portefeuille. Lecture seule : aucun solde n'est touché.
  async reconcileWallet(ambassadorId: string): Promise<WalletReconciliation> {
    const wallet = await this.prisma.ambassadorWallet.findUnique({
      where: { ambassadorId },
    });
    if (!wallet) throw new NotFoundException('Portefeuille introuvable.');

    // L'ordre chronologique est indispensable au contrôle de continuité. À
    // horodatage égal, l'identifiant départage — un cuid est monotone, deux
    // écritures de la même milliseconde restent donc dans leur ordre d'écriture.
    const ledger = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const discrepancies = [
      ...this.checkRebuiltBuckets(wallet, ledger),
      ...this.checkLastSnapshot(wallet, ledger),
    ];
    const continuityBreaks = this.checkContinuity(ledger);

    return {
      ambassadorId,
      walletId: wallet.id,
      currency: wallet.currency,
      transactionCount: ledger.length,
      discrepancies,
      continuityBreaks,
      balanced: discrepancies.length === 0 && continuityBreaks.length === 0,
    };
  }

  // --- Contrôle 1 : soldes reconstitués depuis les sommes signées ------------
  //
  // Seuls `reserved` et `paidTotal` sont reconstituables sans ambiguïté :
  // COMMISSION_CANCELLED retire indifféremment du disponible OU de l'acquis selon
  // l'état de la commission au moment de l'annulation, et le type seul ne dit pas
  // lequel. Le contrôle 2 couvre ces deux poches-là.
  private checkRebuiltBuckets(
    wallet: { reservedMinor: number; paidTotalMinor: number },
    ledger: {
      type: WalletTransactionType;
      amountMinor: number;
      availableDeltaMinor: number | null;
    }[],
  ): BucketDiscrepancy[] {
    let reserved = 0;
    let paidTotal = 0;
    // Une immobilisation antérieure au 2026-08-04 ne porte pas de quoi
    // reconstituer son montant. Plutôt que de rendre un « immobilisé » faux, le
    // contrôle s'abstient sur ce portefeuille : un écart inventé fait perdre
    // plus de temps qu'un contrôle qui se tait.
    let reservedIsRebuildable = true;

    for (const entry of ledger) {
      switch (entry.type) {
        case WalletTransactionType.PAYOUT_RESERVED:
        case WalletTransactionType.PAYOUT_RELEASED: {
          // `amountMinor` vaut ZÉRO sur ces écritures — un déplacement entre
          // poches ne fait rien entrer ni sortir du patrimoine. Le montant
          // déplacé se lit sur l'effet, de signe opposé : ce qui quitte le
          // disponible entre à l'immobilisé, et réciproquement.
          if (entry.availableDeltaMinor === null) {
            reservedIsRebuildable = false;
            break;
          }
          reserved -= entry.availableDeltaMinor;
          break;
        }
        case WalletTransactionType.PAYOUT_EXECUTED: {
          // Celle-ci porte bien son montant : l'argent quitte le patrimoine.
          const amount = Math.abs(entry.amountMinor);
          reserved -= amount;
          paidTotal += amount;
          break;
        }
        default:
          break;
      }
    }

    return [
      reservedIsRebuildable
        ? this.compare('reserved', wallet.reservedMinor, reserved)
        : null,
      this.compare('paidTotal', wallet.paidTotalMinor, paidTotal),
    ].filter((d): d is BucketDiscrepancy => d !== null);
  }

  // --- Contrôle 2 : la dernière photographie doit égaler le cache ------------
  private checkLastSnapshot(
    wallet: { pendingMinor: number; availableMinor: number },
    ledger: { availableAfterMinor: number; pendingAfterMinor: number }[],
  ): BucketDiscrepancy[] {
    // Un portefeuille sans aucune écriture doit être à zéro partout : c'est le
    // seul cas où l'absence de livre est une information, et non un trou.
    const last = ledger[ledger.length - 1];
    const expectedAvailable = last?.availableAfterMinor ?? 0;
    const expectedPending = last?.pendingAfterMinor ?? 0;

    return [
      this.compare('available', wallet.availableMinor, expectedAvailable),
      this.compare('pending', wallet.pendingMinor, expectedPending),
    ].filter((d): d is BucketDiscrepancy => d !== null);
  }

  // --- Contrôle 3 : continuité de la chaîne ---------------------------------
  //
  // Attrape ce que les deux premiers laisseraient passer : une ligne supprimée au
  // milieu, ou insérée, dont les effets se compenseraient sur le total.
  private checkContinuity(
    ledger: {
      id: string;
      type: WalletTransactionType;
      amountMinor: number;
      availableAfterMinor: number;
      availableDeltaMinor: number | null;
    }[],
  ): ContinuityBreak[] {
    const breaks: ContinuityBreak[] = [];

    for (let i = 1; i < ledger.length; i++) {
      const previous = ledger[i - 1];
      const current = ledger[i];
      const delta = this.availableDelta(current);

      // `null` signale un type dont l'effet sur le disponible n'est pas
      // déterminable depuis le seul type : on ne conclut pas plutôt que de crier
      // au loup.
      if (delta === null) continue;

      const expected = previous.availableAfterMinor + delta;
      if (expected !== current.availableAfterMinor) {
        breaks.push({
          transactionId: current.id,
          expectedAvailableMinor: expected,
          recordedAvailableMinor: current.availableAfterMinor,
        });
      }
    }

    return breaks;
  }

  // Effet d'une écriture sur la poche « disponible », ou `null` si le type seul ne
  // permet pas de trancher.
  private availableDelta(entry: {
    type: WalletTransactionType;
    amountMinor: number;
    availableDeltaMinor: number | null;
  }): number | null {
    // LA SOURCE, depuis le 2026-08-04 : l'écriture porte elle-même son effet sur
    // la poche « disponible ».
    //
    // Le déduire du TYPE, comme on le faisait, était un piège : les déplacements
    // entre poches inscrivent `amountMinor: 0` — et c'est correct, puisque cette
    // colonne mesure ce qui entre ou sort du patrimoine, pas ce qui circule
    // entre les poches. Le contrôle calculait donc un delta nul là où le solde
    // bougeait vraiment, et criait à la rupture de chaîne à CHAQUE
    // immobilisation. Un contrôle qui crie au loup en permanence est pire que
    // pas de contrôle : on finit par ne plus le lire.
    if (entry.availableDeltaMinor !== null) return entry.availableDeltaMinor;

    // Écritures antérieures à la colonne. On ne conclut pas : reconstituer leur
    // effet exigerait de deviner à quelle poche chacune a touché.
    return null;
  }

  private compare(
    bucket: BucketDiscrepancy['bucket'],
    cachedMinor: number,
    expectedMinor: number,
  ): BucketDiscrepancy | null {
    if (cachedMinor === expectedMinor) return null;
    return {
      bucket,
      cachedMinor,
      expectedMinor,
      deltaMinor: cachedMinor - expectedMinor,
    };
  }

  // --- Balayage périodique ---------------------------------------------------
  //
  // Parcourt tous les portefeuilles et alerte sur chaque divergence. Ne corrige
  // rien : une correction est une DÉCISION, et une décision se prend par une
  // écriture motivée, pas par un balayage nocturne.
  async runSweep(): Promise<{
    checked: number;
    divergent: WalletReconciliation[];
  }> {
    const wallets = await this.prisma.ambassadorWallet.findMany({
      select: { ambassadorId: true },
    });

    const divergent: WalletReconciliation[] = [];

    for (const { ambassadorId } of wallets) {
      const report = await this.reconcileWallet(ambassadorId);
      if (report.balanced) continue;

      divergent.push(report);
      await this.raiseAlert(report);
    }

    if (divergent.length > 0) {
      this.logger.error(
        `Réconciliation : ${divergent.length} portefeuille(s) en écart sur ${wallets.length}.`,
      );
    } else {
      this.logger.log(
        `Réconciliation : ${wallets.length} portefeuille(s) vérifié(s), aucun écart.`,
      );
    }

    return { checked: wallets.length, divergent };
  }

  // L'écart part au journal d'audit ET aux administrateurs. Le journal parce qu'un
  // écart sur de l'argent doit rester traçable ; les administrateurs parce qu'une
  // trace que personne ne lit ne protège de rien.
  private async raiseAlert(report: WalletReconciliation) {
    await this.audit.recordChange('AMBASSADOR_WALLET_DIVERGENCE', null, {
      entityType: 'AmbassadorWallet',
      entityId: report.walletId,
      // Les écarts sont exprimés comme des changements : poche, valeur en cache,
      // valeur attendue du grand livre.
      changes: report.discrepancies.map((d) => ({
        field: d.bucket,
        oldValue: d.expectedMinor,
        newValue: d.cachedMinor,
      })),
      metadata: {
        ambassadorId: report.ambassadorId,
        currency: report.currency,
        transactionCount: report.transactionCount,
        continuityBreaks: report.continuityBreaks.length,
      },
    });

    await this.notifications.notifyAdmins(
      NotificationType.AMBASSADOR_WALLET_DIVERGENCE,
      {
        ambassadorId: report.ambassadorId,
        walletId: report.walletId,
        discrepancyCount: report.discrepancies.length,
        continuityBreaks: report.continuityBreaks.length,
      },
    );
  }
}
