import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CommissionCap, Prisma } from '../../generated/prisma/client';
import {
  CommissionCapScope,
  CommissionCapWindow,
  CommissionStatus,
} from '../../generated/prisma/enums';
import { AuditService, diffOf } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// ============================================================================
// PLAFONDS DE COMMISSION
//
// Arbitrage 15 du promoteur, 2026-08-02 : plafond par transaction, journalier,
// mensuel, « éventuellement par campagne ou produit ». Puis, mot pour mot :
//
//   « Le dépassement ne doit pas entraîner une réduction silencieuse. »
//
// D'où le choix qui gouverne tout ce fichier : ce service ne CALCULE JAMAIS un
// montant. Il ne sait pas rogner. Il constate qu'un plafond est franchi et le
// dit ; c'est ensuite le moteur de commission qui met la commission en contrôle,
// pour son montant complet. Un service incapable de réduire ne peut pas réduire
// par accident.
//
// LES DEUX AXES. La portée dit QUI partage l'enveloppe (chaque ambassadeur pris
// séparément, une campagne, un produit) ; la fenêtre dit SUR QUELLE PÉRIODE elle
// se remplit. Les combiner en données plutôt qu'en colonnes rend un septième
// plafond possible sans migration.
// ============================================================================
@Injectable()
export class CommissionCapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Le verdict. `exceeded` décide du statut de la commission ; `trace` est ce qui
  // permettra de répondre à « pourquoi la mienne a-t-elle été retenue ? » —
  // avec des chiffres, pas avec une conviction.
  async evaluate(input: CapEvaluationInput): Promise<CapVerdict> {
    const caps = await this.prisma.commissionCap.findMany({
      where: {
        isActive: true,
        // Un plafond libellé en USD n'a rien à dire d'une commission en XAF.
        // Comparer les deux produirait des contrôles au hasard, dans un sens
        // comme dans l'autre.
        currency: input.currency,
        OR: [{ countryCode: null }, { countryCode: input.countryCode }],
      },
    });

    const applicable = caps.filter((cap) => this.applies(cap, input));
    const trace: CapEvaluation[] = [];

    for (const cap of applicable) {
      const consumedMinor = await this.consumed(cap, input);
      const totalMinor = consumedMinor + input.amountMinor;
      trace.push({
        capId: cap.id,
        label: cap.label,
        scope: cap.scope,
        scopeKey: cap.scopeKey,
        window: cap.window,
        limitMinor: cap.amountMinor,
        consumedMinor,
        candidateMinor: input.amountMinor,
        totalMinor,
        exceeded: totalMinor > cap.amountMinor,
      });
    }

    return {
      exceeded: trace.some((t) => t.exceeded),
      trace,
    };
  }

  // Ce plafond concerne-t-il CETTE commission ? Le pays a déjà été filtré en
  // base ; restent la portée et sa clé.
  private applies(cap: CommissionCap, input: CapEvaluationInput): boolean {
    switch (cap.scope) {
      case CommissionCapScope.AMBASSADOR:
        return true;
      case CommissionCapScope.CAMPAIGN:
        // Une commission hors campagne (`campaignKey` nul) n'entame aucune
        // enveloppe de campagne. Sans ce test, un plafond de campagne
        // s'appliquerait à toute l'activité courante.
        return input.campaignKey !== null && input.campaignKey === cap.scopeKey;
      case CommissionCapScope.PRODUCT:
        return input.productKey === cap.scopeKey;
    }
  }

  // Ce qui est DÉJÀ engagé sur la fenêtre du plafond.
  //
  // Les commissions en REVIEW_REQUIRED sont comptées, alors même qu'elles ne sont
  // pas encore acquises. C'est délibéré : sans cela, un ambassadeur dont la
  // première commission attend un arbitrage verrait les suivantes passer sous le
  // plafond une à une, et le contrôle ne servirait à rien. Compter large fait
  // au pire un contrôle de trop ; compter court laisse passer un dépassement.
  //
  // CANCELLED et REVERSED, en revanche, ne consomment rien : l'argent a été
  // repris, l'enveloppe est de nouveau disponible.
  private async consumed(
    cap: CommissionCap,
    input: CapEvaluationInput,
  ): Promise<number> {
    // Le montant candidat est la totalité de la fenêtre TRANSACTION : rien n'est
    // « déjà consommé » sur une commission prise isolément.
    if (cap.window === CommissionCapWindow.TRANSACTION) return 0;

    const since = this.windowStart(cap.window, input.at);

    // Qui partage l'enveloppe. `scopeKey` est garanti non nul hors portée
    // AMBASSADOR par la contrainte CHECK en base ; le `?? ''` n'est là que pour
    // le typage — une clé vide ne correspondrait à aucune commission, donc même
    // une base corrompue donnerait un cumul nul plutôt qu'un cumul faux.
    const scopeFilter =
      cap.scope === CommissionCapScope.AMBASSADOR
        ? { ambassadorId: input.ambassadorId }
        : cap.scope === CommissionCapScope.CAMPAIGN
          ? { appliedCampaignKey: cap.scopeKey }
          : { productKey: cap.scopeKey ?? '' };

    const aggregate = await this.prisma.commission.aggregate({
      _sum: { amountMinor: true },
      where: {
        currency: cap.currency,
        status: {
          notIn: [CommissionStatus.CANCELLED, CommissionStatus.REVERSED],
        },
        ...(since ? { createdAt: { gte: since } } : {}),
        ...(cap.countryCode ? { countryCode: cap.countryCode } : {}),
        ...scopeFilter,
      },
    });

    return aggregate._sum?.amountMinor ?? 0;
  }

  // Début de la fenêtre, en UTC. Le choix est assumé et documenté plutôt que
  // subi : un plafond « journalier » calé sur le fuseau de chaque pays donnerait
  // des bornes différentes selon le pays de la vente, et donc un cumul dont la
  // valeur dépendrait de l'ordre de lecture. La journée UTC est la même pour
  // tout le monde. À revoir si un jour un pays exige la journée civile locale.
  private windowStart(window: CommissionCapWindow, at: Date): Date | null {
    switch (window) {
      case CommissionCapWindow.DAY:
        return new Date(
          Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
        );
      case CommissionCapWindow.MONTH:
        return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
      case CommissionCapWindow.LIFETIME:
        return null;
      case CommissionCapWindow.TRANSACTION:
        return null;
    }
  }

  // --- Back-office ------------------------------------------------------------

  list(activeOnly = false) {
    return this.prisma.commissionCap.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: [{ scope: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(adminUserId: string, input: CommissionCapInput) {
    this.assertScopeKey(input);

    const cap = await this.prisma.commissionCap.create({
      data: {
        label: input.label,
        scope: input.scope,
        scopeKey: input.scopeKey ?? null,
        countryCode: input.countryCode ?? null,
        window: input.window,
        amountMinor: input.amountMinor,
        currency: input.currency,
        createdById: adminUserId,
      },
    });

    await this.audit.recordChange('COMMISSION_CAP_CREATED', adminUserId, {
      entityType: 'CommissionCap',
      entityId: cap.id,
      metadata: {
        label: cap.label,
        scope: cap.scope,
        scopeKey: cap.scopeKey,
        window: cap.window,
        amountMinor: cap.amountMinor,
        currency: cap.currency,
        countryCode: cap.countryCode,
      },
    });

    return cap;
  }

  // Un plafond se DÉSACTIVE, il ne se supprime pas et ne se modifie pas en place.
  // Les commissions qu'il a mises en contrôle portent son identifiant dans leur
  // trace : le faire disparaître rendrait ces contrôles inexplicables. Pour
  // changer un montant, on désactive et on crée — comme pour un barème.
  async deactivate(adminUserId: string, capId: string) {
    const cap = await this.prisma.commissionCap.findUnique({
      where: { id: capId },
    });
    if (!cap) throw new NotFoundException('Plafond introuvable.');

    const updated = await this.prisma.commissionCap.update({
      where: { id: capId },
      data: { isActive: false },
    });

    await this.audit.recordChange('COMMISSION_CAP_DEACTIVATED', adminUserId, {
      entityType: 'CommissionCap',
      entityId: capId,
      changes: diffOf({ isActive: cap.isActive }, { isActive: false }),
      metadata: { label: cap.label, scope: cap.scope, window: cap.window },
    });

    return updated;
  }

  // Le service refuse ce que la base refuse déjà — deux verrous, et surtout un
  // message compréhensible plutôt qu'une violation de contrainte brute.
  private assertScopeKey(input: CommissionCapInput) {
    const needsKey = input.scope !== CommissionCapScope.AMBASSADOR;
    const hasKey = Boolean(input.scopeKey);

    if (needsKey && !hasKey) {
      throw new BadRequestException(
        'Un plafond de campagne ou de produit exige la clé correspondante : sans elle il s’appliquerait à toutes.',
      );
    }
    if (!needsKey && hasKey) {
      throw new BadRequestException(
        'Un plafond par ambassadeur ne porte pas de clé de portée.',
      );
    }
    if (input.amountMinor <= 0) {
      throw new BadRequestException(
        'Un plafond nul ou négatif n’est pas un plafond : pour suspendre les commissions d’un pays, utilisez la politique pays.',
      );
    }
  }
}

export interface CapEvaluationInput {
  ambassadorId: string;
  amountMinor: number;
  currency: string;
  countryCode: string;
  productKey: string;
  // Clé de campagne du barème appliqué, ou null hors campagne.
  campaignKey: string | null;
  at: Date;
}

export interface CapEvaluation {
  capId: string;
  label: string;
  scope: CommissionCapScope;
  scopeKey: string | null;
  window: CommissionCapWindow;
  limitMinor: number;
  consumedMinor: number;
  candidateMinor: number;
  totalMinor: number;
  exceeded: boolean;
}

export interface CapVerdict {
  exceeded: boolean;
  trace: CapEvaluation[];
}

// Prisma n'accepte dans une colonne JSON que ce qui porte une signature d'index ;
// une interface nommée n'en a pas, quand bien même toutes ses valeurs sont
// sérialisables. Ce passage explicite vaut mieux qu'un `as never` dispersé sur
// chaque appel : il dit ce qu'il fait et se cherche en un seul endroit.
export function capTraceAsJson(trace: CapEvaluation[]): Prisma.InputJsonValue {
  return trace as unknown as Prisma.InputJsonValue;
}

export interface CommissionCapInput {
  label: string;
  scope: CommissionCapScope;
  scopeKey?: string | null;
  countryCode?: string | null;
  window: CommissionCapWindow;
  amountMinor: number;
  currency: string;
}
