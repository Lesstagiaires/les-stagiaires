import { useTranslation } from 'react-i18next';
import type { Tone } from '../components/badge';
import type { NotificationCategory, NotificationType } from './api';

// ============================================================================
// RENDU GÉNÉRIQUE DES NOTIFICATIONS
//
// L'écran précédent ne savait rendre QU'UN type sur quarante-neuf et affichait
// l'identifiant brut (« APPLICATION_REJECTED ») pour tous les autres. Ce module
// le remplace par un rendu piloté par les clés i18n, donc exhaustif par
// construction : ajouter un type sans son libellé se voit immédiatement à
// l'écran, et le test de couverture le signale avant la mise en production.
//
// Le serveur n'envoie JAMAIS de phrase : il envoie un type et des métadonnées
// structurées. C'est ici, et seulement ici, que la phrase se compose — dans la
// langue de l'utilisateur.
// ============================================================================

export interface RenderedNotification {
  title: string;
  body: string;
}

export function useNotificationRenderer() {
  const { t } = useTranslation();

  return (
    type: NotificationType,
    metadata?: Record<string, unknown> | null,
  ): RenderedNotification => {
    // i18next remplace {{reference}}, {{organizationName}}… par les métadonnées.
    // Les valeurs absentes deviennent une chaîne vide plutôt que « undefined »
    // affiché en clair au milieu d'une phrase.
    const vars = Object.fromEntries(
      Object.entries(metadata ?? {}).map(([key, value]) => [
        key,
        value == null ? '' : String(value),
      ]),
    );

    return {
      title: t(`labels.notificationType.${type}.title`, {
        ...vars,
        defaultValue: type,
      }),
      body: t(`labels.notificationType.${type}.body`, {
        ...vars,
        defaultValue: '',
      }),
    };
  };
}

export function useCategoryLabels() {
  const { t } = useTranslation();
  return (category: NotificationCategory) =>
    t(`labels.notificationCategory.${category}`, { defaultValue: category });
}

// Teinte par catégorie. Les catégories qui engagent — argent, contrat, sécurité —
// portent une teinte distincte : dans une liste longue, c'est ce qui permet de
// repérer d'un coup d'œil ce qui ne peut pas attendre.
export const CATEGORY_TONE: Record<NotificationCategory, Tone> = {
  APPLICATIONS: 'primary',
  INTERVIEWS: 'accent',
  INTERNSHIPS: 'success',
  AGREEMENTS: 'accent',
  ORGANIZATIONS: 'neutral',
  AMBASSADORS: 'primary',
  MENTORING: 'neutral',
  LEGAL: 'error',
  PAYMENTS: 'success',
  SUBSCRIPTIONS: 'neutral',
  PARTNERSHIPS: 'primary',
  ADMINISTRATION: 'neutral',
  SECURITY: 'error',
  SYSTEM: 'neutral',
};
