import { NotificationType } from '../../generated/prisma/enums';
import type { NotificationsService } from '../notifications/notifications.service';

// ============================================================================
// NOTIFIER UN AMBASSADEUR DONT LE COMPTE PEUT AVOIR DISPARU
//
// Depuis le durcissement du 2026-08-02, `Ambassador.userId` est nullable : le
// dossier survit à la suppression du compte, anonymisé. Le compilateur a désigné
// les douze endroits qui supposaient le contraire — c'était précisément l'intérêt
// de rendre le champ nullable plutôt que de le laisser mentir.
//
// La règle est simple : s'il n'y a plus personne à prévenir, on ne prévient
// personne, MAIS LA DÉCISION EST TOUT DE MÊME JOURNALISÉE. Une résiliation
// prononcée sur un dossier anonymisé reste une résiliation ; seule la
// notification n'a plus de destinataire.
//
// Le retour indique combien de personnes ont été touchées — zéro sur un dossier
// anonymisé — afin que le journal l'enregistre au lieu de l'affirmer.
// ============================================================================
export async function notifyAmbassador(
  notifications: NotificationsService,
  userId: string | null,
  type: NotificationType,
  metadata?: Record<string, unknown>,
): Promise<number> {
  if (!userId) return 0;
  await notifications.notifyUser(userId, type, metadata as never);
  return 1;
}
