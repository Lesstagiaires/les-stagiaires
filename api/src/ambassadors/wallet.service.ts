import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { WalletTransactionType } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

// Accepte indifféremment le client Prisma global ou un client de transaction : toutes
// les écritures d'argent doivent pouvoir être enrôlées dans la transaction de leur
// appelant, sinon une commission pourrait exister sans son écriture de portefeuille.
type Db = PrismaService | Prisma.TransactionClient;

// ============================================================================
// GRAND LIVRE DU PORTEFEUILLE
//
// Les soldes portés par AmbassadorWallet sont un CACHE de lecture. La vérité est
// la suite des WalletTransaction, en ajout seul.
//
// Deux règles tiennent tout l'édifice :
//
//   1. Aucun solde n'est jamais écrit en valeur absolue. Toute variation passe par
//      un increment/decrement atomique, dont on relit le résultat pour horodater le
//      solde obtenu. Deux paiements confirmés au même instant ne peuvent donc pas
//      s'écraser l'un l'autre — ce qu'un « lire, calculer, écrire » autoriserait.
//
//   2. Aucune écriture sans ligne de grand livre. Un solde qui bouge sans trace est
//      un solde qu'on ne saura pas justifier, et sur de l'argent dû à des tiers,
//      « je ne sais pas d'où vient ce montant » n'est pas une réponse acceptable.
//
// Les contraintes CHECK en base interdisent en dernier ressort tout solde négatif :
// même un défaut de ce service ne pourra pas faire verser de l'argent qui n'existe
// pas.
// ============================================================================
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureWallet(db: Db, ambassadorId: string, currency: string) {
    const existing = await db.ambassadorWallet.findUnique({
      where: { ambassadorId },
    });
    if (existing) return existing;

    return db.ambassadorWallet.create({ data: { ambassadorId, currency } });
  }

  // Une commission vient de naître : elle entre en attente, pas en disponible. Elle
  // n'est pas encore exigible — la période de sécurité couvre les annulations et
  // impayés du prestataire de paiement.
  async accrue(
    db: Db,
    ambassadorId: string,
    currency: string,
    amountMinor: number,
    commissionId: string,
  ) {
    const wallet = await this.ensureWallet(db, ambassadorId, currency);
    const updated = await db.ambassadorWallet.update({
      where: { id: wallet.id },
      data: { pendingMinor: { increment: amountMinor } },
    });

    return this.record(db, updated, {
      type: WalletTransactionType.COMMISSION_ACCRUED,
      amountMinor,
      // Une commission naissante entre en attente : le disponible ne bouge pas.
      availableDeltaMinor: 0,
      commissionId,
    });
  }

  // Période de sécurité écoulée : la commission devient exigible.
  async makeAvailable(
    db: Db,
    walletId: string,
    amountMinor: number,
    commissionId: string,
  ) {
    const updated = await db.ambassadorWallet.update({
      where: { id: walletId },
      data: {
        pendingMinor: { decrement: amountMinor },
        availableMinor: { increment: amountMinor },
      },
    });

    return this.record(db, updated, {
      type: WalletTransactionType.COMMISSION_AVAILABLE,
      amountMinor: 0,
      availableDeltaMinor: amountMinor,
      commissionId,
    });
  }

  // Annulation avant paiement : le montant quitte le solde d'où il vient.
  async cancelAccrual(
    db: Db,
    walletId: string,
    amountMinor: number,
    commissionId: string,
    fromAvailable: boolean,
    reason: string,
  ) {
    const updated = await db.ambassadorWallet.update({
      where: { id: walletId },
      data: fromAvailable
        ? { availableMinor: { decrement: amountMinor } }
        : { pendingMinor: { decrement: amountMinor } },
    });

    return this.record(db, updated, {
      type: WalletTransactionType.COMMISSION_CANCELLED,
      amountMinor: -amountMinor,
      // Le type seul ne disait pas de quelle poche l'argent sortait — c'est
      // pourquoi le contrôle de continuité s'abstenait sur ces écritures. Il ne
      // s'abstient plus : l'appelant, lui, le sait.
      availableDeltaMinor: fromAvailable ? -amountMinor : 0,
      commissionId,
      reason,
    });
  }

  // Immobilise un montant le temps qu'une demande de retrait soit instruite. Sans
  // cela, un ambassadeur pourrait déposer deux demandes couvrant chacune la totalité
  // de son solde et se faire payer deux fois.
  async reserveForPayout(
    db: Db,
    walletId: string,
    amountMinor: number,
    payoutRequestId: string,
  ) {
    const wallet = await db.ambassadorWallet.findUniqueOrThrow({
      where: { id: walletId },
    });
    if (wallet.availableMinor < amountMinor) {
      throw new BadRequestException('Solde disponible insuffisant.');
    }

    const updated = await db.ambassadorWallet.update({
      where: { id: walletId },
      data: {
        availableMinor: { decrement: amountMinor },
        reservedMinor: { increment: amountMinor },
      },
    });

    return this.record(db, updated, {
      type: WalletTransactionType.PAYOUT_RESERVED,
      amountMinor: 0,
      availableDeltaMinor: -amountMinor,
      payoutRequestId,
    });
  }

  // Demande rejetée ou annulée : le montant réintègre le disponible.
  async releaseReservation(
    db: Db,
    walletId: string,
    amountMinor: number,
    payoutRequestId: string,
    reason: string,
  ) {
    const updated = await db.ambassadorWallet.update({
      where: { id: walletId },
      data: {
        reservedMinor: { decrement: amountMinor },
        availableMinor: { increment: amountMinor },
      },
    });

    return this.record(db, updated, {
      type: WalletTransactionType.PAYOUT_RELEASED,
      amountMinor: 0,
      availableDeltaMinor: amountMinor,
      payoutRequestId,
      reason,
    });
  }

  // Virement réellement exécuté, constaté par l'administration.
  async executePayout(
    db: Db,
    walletId: string,
    amountMinor: number,
    payoutRequestId: string,
    actorId: string,
  ) {
    const updated = await db.ambassadorWallet.update({
      where: { id: walletId },
      data: {
        reservedMinor: { decrement: amountMinor },
        paidTotalMinor: { increment: amountMinor },
      },
    });

    return this.record(db, updated, {
      type: WalletTransactionType.PAYOUT_EXECUTED,
      amountMinor: -amountMinor,
      // L'argent quitte l'immobilisé : le disponible n'a jamais été touché.
      availableDeltaMinor: 0,
      payoutRequestId,
      actorId,
    });
  }

  // Correction administrative, motif obligatoire.
  //
  // C'est aussi le SEUL chemin pour reprendre une commission déjà versée : l'argent
  // est parti, aucun solde ne peut être « dé-débité » rétroactivement sans mentir sur
  // l'histoire. La reprise se constate ici, avec son motif, et se recouvre hors
  // application.
  async adjust(
    db: Db,
    walletId: string,
    deltaMinor: number,
    actorId: string,
    reason: string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException(
        'Un ajustement de portefeuille exige un motif.',
      );
    }

    const updated = await db.ambassadorWallet.update({
      where: { id: walletId },
      data: { availableMinor: { increment: deltaMinor } },
    });

    return this.record(db, updated, {
      type: WalletTransactionType.ADJUSTMENT,
      amountMinor: deltaMinor,
      // Un ajustement porte sur le disponible, et sur lui seul : c'est la poche
      // que la méthode incrémente juste au-dessus. Les deux valeurs coïncident
      // ici, mais pour deux raisons différentes — l'une dit ce qui entre au
      // patrimoine, l'autre dans quelle poche.
      availableDeltaMinor: deltaMinor,
      actorId,
      reason,
    });
  }

  async ledger(ambassadorId: string, take = 100) {
    const wallet = await this.prisma.ambassadorWallet.findUnique({
      where: { ambassadorId },
    });
    if (!wallet) return { wallet: null, transactions: [] };

    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return { wallet, transactions };
  }

  private async record(
    db: Db,
    wallet: {
      id: string;
      ambassadorId: string;
      availableMinor: number;
      pendingMinor: number;
    },
    entry: {
      type: WalletTransactionType;
      amountMinor: number;
      // Effet signé sur la SEULE poche « disponible ». Obligatoire, et non
      // optionnel : c'est ce qui empêche qu'une écriture future l'oublie, comme
      // l'oubli initial l'avait fait taire le contrôle de continuité.
      availableDeltaMinor: number;
      commissionId?: string;
      payoutRequestId?: string;
      actorId?: string;
      reason?: string;
    },
  ) {
    await db.walletTransaction.create({
      data: {
        walletId: wallet.id,
        // Recopié sur chaque écriture : le grand livre reste rattachable même si
        // le portefeuille — qui n'est qu'un cache de lecture — disparaît.
        ambassadorId: wallet.ambassadorId,
        ...entry,
        availableAfterMinor: wallet.availableMinor,
        pendingAfterMinor: wallet.pendingMinor,
      },
    });
    return wallet;
  }
}
