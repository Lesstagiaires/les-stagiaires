import { Injectable, Logger } from '@nestjs/common';
import {
  AccountStatus,
  SubscriptionNoticeType,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import { MinorPolicyService } from '../auth/minor-policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  NATURE_DE_L_AVIS,
  NatureDeLAvis,
  NOTIFICATION_DE_L_AVIS,
  seuilAtteint,
} from './subscription-notice-types';

// Même forme que dans `subscriptions.service.ts`, et recopiée pour la même
// raison : chaque fichier reste lisible seul, sans aller chercher un utilitaire
// partagé qui n'existe pas dans ce dépôt.
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

// L'abonnement, réduit à ce qu'il faut pour savoir QUOI dire et À QUI.
const POUR_AVIS = {
  id: true,
  plan: true,
  billingCycle: true,
  currentPeriodEnd: true,
  beneficiaryUserId: true,
  beneficiaryOrganizationId: true,
  beneficiaryUser: {
    select: { dateOfBirth: true, countryOfResidence: true, status: true },
  },
} as const;

// ============================================================================
// LE SEUL ENDROIT QUI SIGNALE UN ÉVÈNEMENT D'ABONNEMENT
//
// CE QU'IL NE FAIT JAMAIS, ET NE DOIT JAMAIS FAIRE :
//   — il n'écrit aucun statut d'abonnement. Les transitions restent où elles
//     étaient : activation dans `payments.service.ts`, ACTIVE → EXPIRED dans
//     `subscription-expiry.processor.ts`, et V6-5 n'y a pas touché ;
//   — il n'accorde et ne retire aucun droit ;
//   — il ne déclenche aucune commission. `onPaymentConfirmed` reste appelé
//     depuis le seul endroit qui l'appelait déjà. Une notification n'est pas un
//     évènement de paiement.
//
// SON UNIQUE GARANTIE : un avis donné n'est émis qu'une fois par période. Elle
// n'est pas portée par ce code mais par deux index uniques partiels — voir la
// migration 20260824120000. Ici on tente d'écrire, et on se tait si la base
// refuse.
// ============================================================================
@Injectable()
export class SubscriptionNoticesService {
  private readonly logger = new Logger(SubscriptionNoticesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly minorPolicy: MinorPolicyService,
  ) {}

  // --- Confirmation de paiement ---------------------------------------------
  //
  // `premiereActivation` est décidé par l'appelant, qui seul a vu l'état AVANT
  // l'écriture : `startedAt` est posé une fois pour toutes à la première
  // confirmation, donc le lire après coup ne dirait plus rien.
  async signalerPaiementConfirme(
    subscriptionId: string,
    premiereActivation: boolean,
  ): Promise<void> {
    await this.emettre(
      subscriptionId,
      premiereActivation
        ? SubscriptionNoticeType.ACTIVATED
        : SubscriptionNoticeType.RENEWED,
    );
  }

  // --- Fin de couverture ------------------------------------------------------
  //
  // Reçoit les identifiants de ce qui VIENT d'expirer. Un abonnement expiré
  // avant l'existence de V6-5 n'en fait donc jamais partie : on ne réveille pas
  // des fins de couverture vieilles de plusieurs mois pour la seule raison
  // qu'on sait désormais les annoncer.
  async signalerFinDeCouverture(subscriptionIds: string[]): Promise<void> {
    for (const id of subscriptionIds) {
      await this.emettre(id, SubscriptionNoticeType.COVERAGE_ENDED);
    }
  }

  // --- Anticipation de l'échéance ---------------------------------------------
  //
  // Ne lit que des abonnements ACTIFS ayant une période : un ONE_TIME
  // (`currentPeriodEnd` nul) n'a rien à faire expirer, et le filtre l'écarte à
  // la source plutôt que de compter sur un `if` plus bas.
  async balayerEcheances(maintenant = new Date()): Promise<number> {
    const abonnements = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { not: null, gt: maintenant },
      },
      select: POUR_AVIS,
    });

    let emis = 0;
    for (const abonnement of abonnements) {
      // `currentPeriodEnd` est non nul par la requête ; le garde rassure le
      // typage sans rien décider.
      if (!abonnement.currentPeriodEnd) continue;

      const seuil = seuilAtteint(abonnement.currentPeriodEnd, maintenant);
      if (!seuil) continue;

      if (await this.emettre(abonnement.id, seuil.type)) emis += 1;
    }
    return emis;
  }

  // --- Le mécanisme commun -----------------------------------------------------
  private async emettre(
    subscriptionId: string,
    type: SubscriptionNoticeType,
  ): Promise<boolean> {
    const abonnement = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: POUR_AVIS,
    });
    if (!abonnement) return false;

    if (await this.aSupprimerPourMineur(abonnement, type)) return false;

    // 1. RÉSERVER. L'insertion est la garde : si une autre exécution a déjà
    //    réservé cet avis pour cette période, la base refuse et l'on s'arrête
    //    ici, sans avoir rien envoyé.
    let noticeId: string;
    try {
      const notice = await this.prisma.subscriptionNotice.create({
        data: {
          subscriptionId,
          type,
          periodEnd: abonnement.currentPeriodEnd,
        },
        select: { id: true },
      });
      noticeId = notice.id;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }

    // 2. ENVOYER. Hors de toute transaction : garder une transaction ouverte
    //    pendant un appel réseau tiendrait un verrou sur la ligne aussi
    //    longtemps que le fournisseur met à répondre.
    await this.diffuser(abonnement, type);

    // 3. CONFIRMER. Mourir entre 2 et 3 laisse une ligne sans `sentAt` — un avis
    //    perdu, mais VISIBLE et interrogeable, là où un booléen aurait affirmé
    //    qu'il était parti.
    await this.prisma.subscriptionNotice.update({
      where: { id: noticeId },
      data: { sentAt: new Date() },
    });
    return true;
  }

  // LE DESTINATAIRE SE DÉDUIT DU BÉNÉFICIAIRE, JAMAIS DU PAYEUR.
  // `initiatingOrganizationId` n'est pas lu : dans un parrainage, l'organisation
  // paie mais c'est la personne qui est couverte, et c'est elle que l'échéance
  // concerne.
  private async diffuser(
    abonnement: {
      id: string;
      plan: string;
      currentPeriodEnd: Date | null;
      beneficiaryUserId: string | null;
      beneficiaryOrganizationId: string | null;
    },
    type: SubscriptionNoticeType,
  ): Promise<void> {
    const notification = NOTIFICATION_DE_L_AVIS[type];
    const metadata = {
      subscriptionId: abonnement.id,
      plan: abonnement.plan,
      currentPeriodEnd: abonnement.currentPeriodEnd?.toISOString() ?? null,
    };

    if (abonnement.beneficiaryUserId) {
      await this.notifications.notifyUser(
        abonnement.beneficiaryUserId,
        notification,
        metadata,
      );
      return;
    }

    if (abonnement.beneficiaryOrganizationId) {
      await this.notifications.notifyOrganizationLeadership(
        abonnement.beneficiaryOrganizationId,
        notification,
        metadata,
      );
      return;
    }

    // Ni personne ni organisation : la ligne est incohérente. Aucune contrainte
    // ne l'interdit aujourd'hui en base — réserve constatée en revue V6-5 et
    // laissée hors périmètre. On le journalise plutôt que de le taire.
    this.logger.warn(
      `Abonnement ${abonnement.id} sans bénéficiaire : avis ${type} non diffusé.`,
    );
  }

  // LA QUALITÉ DE MINEUR EST RECALCULÉE, JAMAIS LUE.
  //
  // `User.isMinor` est écrit à l'inscription et n'est jamais mis à jour : un
  // jeune inscrit à dix-sept ans le reste à vingt-cinq. Un balayage périodique
  // s'y est déjà fié dans ce dépôt et a envoyé un message au « représentant
  // légal » d'un adulte — voir `is-minor-not-read-elsewhere.spec.ts`. V6-5
  // passe donc par `requiresParentalConsent`, qui recalcule depuis la date de
  // naissance et la politique du pays, et ne stocke rien.
  //
  // SEULES LES SOLLICITATIONS SONT SUPPRIMÉES. Un mineur reste informé de ce
  // qui le concerne — son abonnement est actif, il a été reconduit, il s'est
  // arrêté. Ce qu'on ne fait pas, c'est l'inviter à payer.
  private async aSupprimerPourMineur(
    abonnement: {
      beneficiaryUserId: string | null;
      beneficiaryUser: {
        dateOfBirth: Date | null;
        countryOfResidence: string | null;
        status: AccountStatus;
      } | null;
    },
    type: SubscriptionNoticeType,
  ): Promise<boolean> {
    if (NATURE_DE_L_AVIS[type] !== NatureDeLAvis.SOLLICITATION) return false;

    // Une organisation n'a pas d'âge.
    if (!abonnement.beneficiaryUserId || !abonnement.beneficiaryUser) {
      return false;
    }

    return this.minorPolicy.requiresParentalConsent(abonnement.beneficiaryUser);
  }
}
