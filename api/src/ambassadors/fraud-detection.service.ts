import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { FraudRule, Prisma } from '../../generated/prisma/client';
import {
  CommissionStatus,
  FraudAlertStatus,
  FraudSignal,
  NotificationType,
  PayoutRequestStatus,
} from '../../generated/prisma/enums';
import { AuditService, diffOf } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

// ============================================================================
// DÉTECTION DE FRAUDE — PREMIÈRES ALERTES
//
// Arbitrage du promoteur du 2026-08-04 :
//
//   « Elles ne devront JAMAIS entraîner automatiquement une sanction, une
//     suspension ou un refus de paiement. Leur rôle est uniquement de :
//     détecter ; alerter ; journaliser ; orienter l'administration vers un
//     contrôle manuel. »
//
// CE SERVICE N'A AUCUN POUVOIR, ET C'EST VOULU. Il ne reçoit ni
// AmbassadorsService, ni CommissionsService, ni PayoutsService, ni
// WalletService : il lit la base et écrit des alertes. Il ne PEUT pas suspendre
// un ambassadeur, bloquer une commission ou refuser un virement, parce qu'il
// n'en a matériellement pas les moyens. Un test (`fraud-no-sanction.spec.ts`)
// interdit à ces dépendances de réapparaître.
//
// Même principe que ReconciliationService : constater et alerter, jamais
// corriger. Une machine qui sanctionne toute seule finit par sanctionner à tort,
// et la personne lésée n'a alors personne à qui demander pourquoi.
//
// POURQUOI UNE ÉNUMÉRATION DE SIGNAUX plutôt qu'un langage de règles. Un moteur
// d'expressions serait plus « configurable » sur le papier, et intestable en
// pratique : chaque signal a ici son calcul écrit, lisible et couvert. La
// configuration porte sur le SEUIL et la FENÊTRE — les deux choses qu'on veut
// vraiment régler sans redéployer.
// ============================================================================
@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // Balayage complet : chaque règle active est évaluée sur chaque ambassadeur
  // concerné. Appelé par la tâche quotidienne.
  async runSweep(now = new Date()): Promise<FraudSweepReport> {
    const rules = await this.prisma.fraudRule.findMany({
      where: { isActive: true },
    });

    const raised: string[] = [];
    let evaluated = 0;

    for (const rule of rules) {
      const observations = await this.observe(rule, now);
      evaluated += observations.length;

      for (const observation of observations) {
        if (observation.observedValue < rule.thresholdValue) continue;
        const alerte = await this.raise(rule, observation, now);
        if (alerte) raised.push(alerte);
      }
    }

    if (raised.length > 0) {
      this.logger.warn(
        `Antifraude : ${raised.length} alerte(s) levée(s) sur ${rules.length} règle(s).`,
      );
    } else {
      this.logger.log(
        `Antifraude : ${rules.length} règle(s) évaluée(s), aucun signalement.`,
      );
    }

    return { rules: rules.length, evaluated, raised: raised.length };
  }

  // --- LES CALCULS ------------------------------------------------------------
  // Un signal = une méthode, écrite et testée. Rien n'est interprété.

  private async observe(
    rule: FraudRule,
    now: Date,
  ): Promise<FraudObservation[]> {
    const from = new Date(now.getTime() - rule.windowHours * 3600 * 1000);
    const pays = rule.countryCode ? { countryCode: rule.countryCode } : {};

    switch (rule.signal) {
      case FraudSignal.ATTRIBUTION_BURST:
        return this.attributionBurst(from, now, rule);
      case FraudSignal.COMMISSION_VOLUME:
        return this.commissionVolume(from, now, pays);
      case FraudSignal.PAYOUT_AFTER_DETAILS_CHANGE:
        return this.payoutAfterDetailsChange(from, now, pays);
      case FraudSignal.REPEATED_PAYOUT_FAILURE:
        return this.repeatedPayoutFailure(from, now, pays);
    }
  }

  // Rafale d'attributions. Le scénario : quelqu'un fabrique des comptes pour
  // s'attribuer des filleuls. Un ambassadeur réellement actif en apporte
  // plusieurs par semaine ; dix en une heure n'est pas de la performance.
  private async attributionBurst(
    from: Date,
    to: Date,
    rule: FraudRule,
  ): Promise<FraudObservation[]> {
    const parrainages = await this.prisma.ambassadorReferral.groupBy({
      by: ['ambassadorId'],
      where: { attributedAt: { gte: from, lte: to } },
      _count: { _all: true },
    });

    const rattachements = await this.prisma.ambassadorPortfolioEntry.groupBy({
      by: ['ambassadorId'],
      where: { createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    });

    // Les deux chemins d'attribution comptent ensemble : les séparer laisserait
    // passer quelqu'un qui alterne entre eux.
    const total = new Map<string, number>();
    for (const ligne of [...parrainages, ...rattachements]) {
      total.set(
        ligne.ambassadorId,
        (total.get(ligne.ambassadorId) ?? 0) + ligne._count._all,
      );
    }

    const observations: FraudObservation[] = [];
    for (const [ambassadorId, observedValue] of total) {
      if (observedValue < rule.thresholdValue) continue;
      observations.push({
        ambassadorId,
        observedValue,
        from,
        to,
        evidence: {
          parrainages:
            parrainages.find((p) => p.ambassadorId === ambassadorId)?._count
              ._all ?? 0,
          rattachements:
            rattachements.find((r) => r.ambassadorId === ambassadorId)?._count
              ._all ?? 0,
        },
      });
    }
    return observations;
  }

  // Volume de commissions acquis sur la fenêtre, en unités mineures. Les
  // commissions annulées et reprises sont exclues : elles ne représentent aucun
  // gain, et les compter signalerait quelqu'un dont on a déjà corrigé le cas.
  private async commissionVolume(
    from: Date,
    to: Date,
    pays: { countryCode?: string },
  ): Promise<FraudObservation[]> {
    const lignes = await this.prisma.commission.groupBy({
      by: ['ambassadorId'],
      where: {
        createdAt: { gte: from, lte: to },
        status: {
          notIn: [CommissionStatus.CANCELLED, CommissionStatus.REVERSED],
        },
        ...pays,
      },
      _sum: { amountMinor: true },
      _count: { _all: true },
    });

    return lignes.map((ligne) => ({
      ambassadorId: ligne.ambassadorId,
      observedValue: ligne._sum.amountMinor ?? 0,
      from,
      to,
      evidence: { commissions: ligne._count._all },
    }));
  }

  // Demande de versement déposée après un changement de coordonnées.
  //
  // Le délai de refroidissement empêche déjà le virement de partir. Ce signal
  // ne protège donc pas l'argent — il REMARQUE la tentative, et c'est cela le
  // renseignement : quelqu'un qui change un numéro puis demande aussitôt un
  // retrait se comporte comme quelqu'un qui est pressé de sortir des fonds.
  private async payoutAfterDetailsChange(
    from: Date,
    to: Date,
    pays: { countryCode?: string },
  ): Promise<FraudObservation[]> {
    const demandes = await this.prisma.payoutRequest.findMany({
      where: { requestedAt: { gte: from, lte: to }, ...pays },
      select: {
        id: true,
        ambassadorId: true,
        requestedAt: true,
        amountMinor: true,
      },
    });
    if (demandes.length === 0) return [];

    const coordonnees = await this.prisma.ambassadorPaymentDetail.findMany({
      where: {
        ambassadorId: { in: demandes.map((d) => d.ambassadorId) },
        changedAt: { gte: from },
      },
      select: { ambassadorId: true, changedAt: true },
    });

    const changees = new Map(
      coordonnees.map((c) => [c.ambassadorId, c.changedAt]),
    );

    const parAmbassadeur = new Map<string, FraudObservation>();
    for (const demande of demandes) {
      const changeeLe = changees.get(demande.ambassadorId);
      // La demande doit suivre le changement, pas le précéder : demander un
      // versement puis corriger un numéro erroné est un comportement ordinaire.
      if (!changeeLe || demande.requestedAt < changeeLe) continue;

      const existante = parAmbassadeur.get(demande.ambassadorId);
      parAmbassadeur.set(demande.ambassadorId, {
        ambassadorId: demande.ambassadorId,
        observedValue: (existante?.observedValue ?? 0) + 1,
        from,
        to,
        evidence: {
          coordonneesChangeesLe: changeeLe.toISOString(),
          demandes: [
            ...((existante?.evidence?.demandes as string[]) ?? []),
            demande.id,
          ],
        },
      });
    }
    return [...parAmbassadeur.values()];
  }

  // Échecs de virement répétés. Souvent des coordonnées erronées — parfois un
  // essai de destination qui n'appartient pas au titulaire.
  private async repeatedPayoutFailure(
    from: Date,
    to: Date,
    pays: { countryCode?: string },
  ): Promise<FraudObservation[]> {
    const lignes = await this.prisma.payoutRequest.groupBy({
      by: ['ambassadorId'],
      where: {
        status: PayoutRequestStatus.FAILED,
        failedAt: { gte: from, lte: to },
        ...pays,
      },
      _count: { _all: true },
    });

    return lignes.map((ligne) => ({
      ambassadorId: ligne.ambassadorId,
      observedValue: ligne._count._all,
      from,
      to,
      evidence: { echecs: ligne._count._all },
    }));
  }

  // --- LEVER UNE ALERTE -------------------------------------------------------

  private async raise(
    rule: FraudRule,
    observation: FraudObservation,
    now: Date,
  ): Promise<string | null> {
    // Le délai de re-signalement. Sans lui, un balayage quotidien rejouerait la
    // même alerte chaque matin jusqu'à ce que l'administration cesse de les
    // lire — et c'est ce jour-là que la vraie passerait inaperçue.
    if (rule.cooldownHours > 0) {
      const depuis = new Date(now.getTime() - rule.cooldownHours * 3600 * 1000);
      const recente = await this.prisma.fraudAlert.findFirst({
        where: {
          ruleCode: rule.code,
          ambassadorId: observation.ambassadorId,
          createdAt: { gte: depuis },
        },
        select: { id: true },
      });
      if (recente) return null;
    }

    const ambassadeur = await this.prisma.ambassador.findUnique({
      where: { id: observation.ambassadorId },
      select: { code: true, countryCode: true },
    });

    const alerte = await this.prisma.fraudAlert.create({
      data: {
        ruleId: rule.id,
        ruleCode: rule.code,
        signal: rule.signal,
        severity: rule.severity,
        ambassadorId: observation.ambassadorId,
        // Recopiés : l'alerte reste identifiable même après anonymisation du
        // dossier. Le journal perd l'auteur, jamais le fait.
        ambassadorCode: ambassadeur?.code ?? null,
        countryCode: ambassadeur?.countryCode ?? null,
        observedValue: observation.observedValue,
        thresholdValue: rule.thresholdValue,
        windowHours: rule.windowHours,
        observedFrom: observation.from,
        observedTo: observation.to,
        // Cast explicite vers le type JSON de Prisma : une interface nommée
        // n'a pas de signature d'index, quand bien même toutes ses valeurs
        // sont sérialisables.
        evidence: (observation.evidence ?? {}) as Prisma.InputJsonValue,
      },
    });

    await this.audit.record('AMBASSADOR_FRAUD_ALERT_RAISED', null, {
      alertId: alerte.id,
      ruleCode: rule.code,
      signal: rule.signal,
      severity: rule.severity,
      ambassadorId: observation.ambassadorId,
      observedValue: observation.observedValue,
      thresholdValue: rule.thresholdValue,
    });

    // L'ADMINISTRATION, et elle seule. Prévenir l'intéressé qu'il est surveillé
    // est le meilleur moyen de lui apprendre à ne plus l'être.
    await this.notifications.notifyAdmins(
      NotificationType.AMBASSADOR_FRAUD_ALERT,
      {
        alertId: alerte.id,
        ruleCode: rule.code,
        severity: rule.severity,
        ambassadorCode: ambassadeur?.code ?? null,
        observedValue: observation.observedValue,
        thresholdValue: rule.thresholdValue,
      },
    );

    return alerte.id;
  }

  // --- L'INSTRUCTION ----------------------------------------------------------
  // Confirmer ou écarter une alerte ne fait RIEN d'autre que la classer. Les
  // suites — suspension, blocage d'une commission, refus d'un versement — se
  // prennent par les chemins qui existent déjà, et qui exigent tous un motif
  // écrit et un auteur nommé.

  async review(
    adminUserId: string,
    alertId: string,
    input: { status: FraudAlertStatus; note: string },
  ) {
    if (input.status === FraudAlertStatus.OPEN) {
      throw new BadRequestException(
        'Instruire une alerte, c’est la confirmer ou l’écarter — pas la laisser ouverte.',
      );
    }

    const alerte = await this.prisma.fraudAlert.findUnique({
      where: { id: alertId },
    });
    if (!alerte) throw new NotFoundException('Alerte introuvable.');
    if (alerte.status !== FraudAlertStatus.OPEN) {
      throw new ConflictException('Cette alerte a déjà été instruite.');
    }

    const instruite = await this.prisma.fraudAlert.update({
      where: { id: alertId },
      data: {
        status: input.status,
        reviewedAt: new Date(),
        reviewedById: adminUserId,
        reviewNote: input.note,
      },
    });

    await this.audit.recordChange(
      'AMBASSADOR_FRAUD_ALERT_REVIEWED',
      adminUserId,
      {
        entityType: 'FraudAlert',
        entityId: alertId,
        changes: diffOf(
          { status: FraudAlertStatus.OPEN },
          { status: input.status },
        ),
        metadata: {
          ruleCode: alerte.ruleCode,
          ambassadorId: alerte.ambassadorId,
          // La note d'instruction reste ici, au back-office. Elle ne part dans
          // aucune notification : l'intéressé n'est pas destinataire de ce
          // dossier.
          note: input.note,
        },
      },
    );

    return instruite;
  }

  list(filters: { status?: FraudAlertStatus; ambassadorId?: string } = {}) {
    return this.prisma.fraudAlert.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.ambassadorId ? { ambassadorId: filters.ambassadorId } : {}),
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  // --- LES RÈGLES (back-office) -----------------------------------------------

  listRules() {
    return this.prisma.fraudRule.findMany({ orderBy: { code: 'asc' } });
  }

  async createRule(adminUserId: string, input: FraudRuleInput) {
    const rule = await this.prisma.fraudRule.create({
      data: {
        code: input.code,
        label: input.label,
        signal: input.signal,
        countryCode: input.countryCode ?? null,
        thresholdValue: input.thresholdValue,
        windowHours: input.windowHours,
        severity: input.severity,
        cooldownHours: input.cooldownHours ?? 24,
        createdById: adminUserId,
      },
    });

    await this.audit.recordChange('FRAUD_RULE_CREATED', adminUserId, {
      entityType: 'FraudRule',
      entityId: rule.id,
      metadata: {
        code: rule.code,
        signal: rule.signal,
        thresholdValue: rule.thresholdValue,
        windowHours: rule.windowHours,
        severity: rule.severity,
      },
    });

    return rule;
  }

  // Un seuil se REMPLACE en place, contrairement à un barème de commission : une
  // règle de détection ne produit aucun droit acquis, et les alertes déjà levées
  // portent le seuil qui les a produites. L'historique reste donc exact.
  async updateRuleThreshold(
    adminUserId: string,
    ruleId: string,
    input: { thresholdValue: number; windowHours: number; note: string },
  ) {
    const rule = await this.prisma.fraudRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) throw new NotFoundException('Règle introuvable.');

    const updated = await this.prisma.fraudRule.update({
      where: { id: ruleId },
      data: {
        thresholdValue: input.thresholdValue,
        windowHours: input.windowHours,
      },
    });

    await this.audit.recordChange('FRAUD_RULE_ADJUSTED', adminUserId, {
      entityType: 'FraudRule',
      entityId: ruleId,
      changes: diffOf(
        {
          thresholdValue: rule.thresholdValue,
          windowHours: rule.windowHours,
        },
        {
          thresholdValue: input.thresholdValue,
          windowHours: input.windowHours,
        },
      ),
      // Desserrer un seuil est exactement ce qu'un administrateur complice
      // ferait avant de laisser passer une fraude. Le motif est donc exigé.
      metadata: { code: rule.code, note: input.note },
    });

    return updated;
  }

  async setRuleActive(adminUserId: string, ruleId: string, isActive: boolean) {
    const rule = await this.prisma.fraudRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) throw new NotFoundException('Règle introuvable.');

    const updated = await this.prisma.fraudRule.update({
      where: { id: ruleId },
      data: { isActive },
    });

    await this.audit.recordChange('FRAUD_RULE_TOGGLED', adminUserId, {
      entityType: 'FraudRule',
      entityId: ruleId,
      changes: diffOf({ isActive: rule.isActive }, { isActive }),
      metadata: { code: rule.code },
    });

    return updated;
  }
}

interface FraudObservation {
  ambassadorId: string;
  observedValue: number;
  from: Date;
  to: Date;
  evidence?: Record<string, unknown>;
}

export interface FraudSweepReport {
  rules: number;
  evaluated: number;
  raised: number;
}

export interface FraudRuleInput {
  code: string;
  label: string;
  signal: FraudSignal;
  countryCode?: string | null;
  thresholdValue: number;
  windowHours: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  cooldownHours?: number;
}
