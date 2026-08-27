import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { colors, ErrorText, SecondaryButton } from '../../../components/form';
import { Section } from '../../../components/section';
import { spacing, typography } from '../../../components/theme';
import {
  api,
  ApiError,
  type ActiveEntitlements,
  type Subscription,
  type SubscriptionStatus,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { formatAmountMinor } from '../../../lib/money';
import {
  SUBSCRIPTION_STATUS_TONE,
  useBillingCycleLabels,
  useSubscriptionPlanLabels,
  useSubscriptionStatusLabels,
} from '../../../lib/subscription-labels';
import { libellesEntitlements } from '../../../lib/entitlement-labels';

const CANCELLABLE_STATUSES = new Set<SubscriptionStatus>(['PENDING_PAYMENT', 'ACTIVE']);

const JOUR_MS = 24 * 60 * 60 * 1000;
// Même valeur que FENETRE_RENOUVELLEMENT_JOURS côté serveur. Recopiée parce que
// le mobile ne partage aucun module avec l'API, et VÉRIFIÉE de l'autre côté :
// `api/src/subscriptions/subscription-notices.service.spec.ts` lit cette ligne
// et échoue si les deux valeurs divergent. Sans cela, l'écran annoncerait un
// jour une ouverture que le serveur refuserait encore.
const FENETRE_RENOUVELLEMENT_JOURS = 30;

type RenouvellementEtat =
  | { possible: true }
  | { possible: false; motif: 'ONE_TIME' | 'PAIEMENT_EN_COURS' | 'RESILIE' | 'TROP_TOT'; ouvertureLe?: Date };

// ============================================================================
// POURQUOI CETTE RÈGLE EXISTE AUSSI ICI
//
// Elle REPRODUIT `assertRenouvelable` (subscriptions.service.ts), elle ne le
// remplace pas : le serveur revérifie tout, et lui seul décide. Ce miroir ne
// sert qu'à ne pas afficher un bouton qui échouerait — et surtout à DIRE
// POURQUOI, là où un bouton grisé sans explication laisse l'utilisateur deviner.
//
// Elle n'accorde donc aucun droit. Au pire, elle se trompe et l'utilisateur voit
// l'erreur du serveur, exactement comme avant V6-5.
// ============================================================================
function etatDuRenouvellement(
  subscription: Subscription,
  maintenant: number,
): RenouvellementEtat {
  if (subscription.billingCycle === 'ONE_TIME') {
    return { possible: false, motif: 'ONE_TIME' };
  }
  if (subscription.status === 'PENDING_PAYMENT') {
    return { possible: false, motif: 'PAIEMENT_EN_COURS' };
  }
  if (subscription.status === 'CANCELLED') {
    return { possible: false, motif: 'RESILIE' };
  }
  // EXPIRED et PAYMENT_FAILED se reconduisent sans condition de date : il n'y a
  // plus de période à protéger.
  if (subscription.status !== 'ACTIVE') return { possible: true };
  if (!subscription.currentPeriodEnd) return { possible: true };

  const fin = new Date(subscription.currentPeriodEnd).getTime();
  const restantMs = fin - maintenant;
  if (restantMs > FENETRE_RENOUVELLEMENT_JOURS * JOUR_MS) {
    return {
      possible: false,
      motif: 'TROP_TOT',
      ouvertureLe: new Date(fin - FENETRE_RENOUVELLEMENT_JOURS * JOUR_MS),
    };
  }
  return { possible: true };
}

// Le nombre de jours entiers restants. Arrondi au SUPÉRIEUR : à onze heures de
// l'échéance, « il reste 1 jour » est plus juste que « il reste 0 jour », qui
// donnerait à croire que tout est déjà fini.
function joursRestants(fin: string, maintenant: number): number {
  return Math.max(0, Math.ceil((new Date(fin).getTime() - maintenant) / JOUR_MS));
}

export default function SubscriptionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const statusLabels = useSubscriptionStatusLabels();
  const planLabels = useSubscriptionPlanLabels();
  const billingCycleLabels = useBillingCycleLabels();

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [activeEntitlements, setActiveEntitlements] = useState<ActiveEntitlements | null>(null);
  const [entitlementsError, setEntitlementsError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isRenewing, setIsRenewing] = useState(false);
  const [renewError, setRenewError] = useState<string | null>(null);
  const [renewNotice, setRenewNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      const nextSubscription = await api.getSubscription(accessToken, id);
      setSubscription(nextSubscription);
      try {
        setActiveEntitlements(await api.getMyEntitlements(accessToken));
        setEntitlementsError(null);
      } catch (err) {
        setActiveEntitlements(null);
        setEntitlementsError(
          err instanceof ApiError ? err.message : t('subscriptions.loadError'),
        );
      }
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('subscriptions.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [id, accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function handleCancel() {
    if (!accessToken || !id) return;
    setCancelError(null);
    setIsCancelling(true);
    try {
      await api.cancelSubscription(accessToken, id);
      await reload();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : t('subscriptions.detail.cancelError'));
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleRenew() {
    if (!accessToken || !id) return;
    setRenewError(null);
    setRenewNotice(null);
    setIsRenewing(true);
    try {
      const result = await api.renewSubscription(accessToken, id);
      // Le paiement n'est pas encore encaissé : l'abonnement repasse en attente.
      // Le dire évite qu'on croie la reconduction acquise dès l'appui.
      setRenewNotice(
        result.payment.instructions ?? t('subscriptions.detail.renewPending'),
      );
      await reload();
    } catch (err) {
      setRenewError(
        err instanceof ApiError ? err.message : t('subscriptions.detail.renewError'),
      );
    } finally {
      setIsRenewing(false);
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !subscription || !accessToken) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{loadError ?? t('subscriptions.detail.notFound')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  // Figé au rendu : recalculer à chaque ligne ferait varier le nombre de jours
  // au milieu d'un même écran si l'on franchit minuit pendant la lecture.
  const maintenant = Date.now();
  const renouvellement = etatDuRenouvellement(subscription, maintenant);
  // ONE_TIME n'a pas d'échéance périodique : aucune de ces lignes ne le concerne.
  const periodique = subscription.billingCycle !== 'ONE_TIME';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{planLabels[subscription.plan]}</Text>
          <Badge
            label={statusLabels[subscription.status]}
            tone={SUBSCRIPTION_STATUS_TONE[subscription.status]}
          />
        </View>

        <Section title={t('subscriptions.detail.planSection')}>
          <Text style={typography.body}>
            {formatAmountMinor(subscription.amountMinor, subscription.currency, i18n.language)}
            {' — '}
            {billingCycleLabels[subscription.billingCycle]}
          </Text>
          {!!subscription.startedAt && (
            <Text style={typography.caption}>
              {t('subscriptions.startedLabel', {
                date: new Date(subscription.startedAt).toLocaleDateString(i18n.language),
              })}
            </Text>
          )}
          {!!subscription.currentPeriodEnd && (
            <Text style={typography.caption}>
              {t('subscriptions.periodEndLabel', {
                date: new Date(subscription.currentPeriodEnd).toLocaleDateString(i18n.language),
              })}
            </Text>
          )}
          {!!subscription.cancelledAt && (
            <Text style={typography.caption}>
              {t('subscriptions.cancelledLabel', {
                date: new Date(subscription.cancelledAt).toLocaleDateString(i18n.language),
              })}
            </Text>
          )}
        </Section>

        {activeEntitlements?.plan === subscription.plan && activeEntitlements.entitlements.length > 0 && (
          <Section title="Droits actifs">
            <Text style={typography.caption}>
              Les droits inclus dans votre formule sont actifs pendant votre période payée.
            </Text>
            {libellesEntitlements(activeEntitlements.entitlements).map((label) => (
              <Text key={label} style={typography.body}>
                {'• '}{label}
              </Text>
            ))}
          </Section>
        )}
        {!!entitlementsError && !activeEntitlements && (
          <ErrorText>{entitlementsError}</ErrorText>
        )}

        {/* V6-5 — LE CYCLE DE VIE, RENDU LISIBLE.
            Une date de fin seule ne dit rien à qui ne compte pas les jours : on
            affiche donc la durée restante, le moment où la reconduction s'ouvre,
            et ce qui se passe une fois l'échéance franchie. */}
        {periodique && (
          <Section title={t('subscriptions.detail.lifecycleSection')}>
            {subscription.status === 'ACTIVE' && !!subscription.currentPeriodEnd && (
              <Text style={typography.body}>
                {t('subscriptions.detail.remaining', {
                  count: joursRestants(subscription.currentPeriodEnd, maintenant),
                })}
              </Text>
            )}

            {renouvellement.possible ? (
              <Text style={typography.caption}>
                {t('subscriptions.detail.renewOpen')}
              </Text>
            ) : (
              <Text style={typography.caption}>
                {renouvellement.motif === 'TROP_TOT' && renouvellement.ouvertureLe
                  ? t('subscriptions.detail.renewOpensOn', {
                      date: renouvellement.ouvertureLe.toLocaleDateString(i18n.language),
                    })
                  : t(`subscriptions.detail.renewBlocked.${renouvellement.motif}`)}
              </Text>
            )}

            {/* Ce que l'on garde après l'échéance. Le dire ici, et pas seulement
                dans l'e-mail, évite la crainte de perdre son profil ou ses
                documents en laissant expirer un abonnement. */}
            <Text style={typography.caption}>
              {subscription.status === 'EXPIRED'
                ? t('subscriptions.detail.afterExpiry')
                : t('subscriptions.detail.onExpiry')}
            </Text>
          </Section>
        )}

        {renouvellement.possible && (
          <Section title={t('subscriptions.detail.renewSection')}>
            <ErrorText>{renewError}</ErrorText>
            {!!renewNotice && <Text style={typography.body}>{renewNotice}</Text>}
            <SecondaryButton
              title={t('subscriptions.detail.renewButton')}
              onPress={handleRenew}
              loading={isRenewing}
            />
            <Text style={typography.caption}>
              {t('subscriptions.detail.renewNoDayLost')}
            </Text>
          </Section>
        )}

        {subscription.status === 'PENDING_PAYMENT' && (
          <Section title={t('subscriptions.detail.paymentSection')}>
            <Text style={typography.body}>{t('subscriptions.detail.pendingNotice')}</Text>
            <SecondaryButton title={t('subscriptions.detail.refresh')} onPress={reload} />
          </Section>
        )}

        {CANCELLABLE_STATUSES.has(subscription.status) && (
          <Section title={t('subscriptions.detail.manageSection')}>
            <ErrorText>{cancelError}</ErrorText>
            <SecondaryButton
              title={t('subscriptions.detail.cancelButton')}
              onPress={handleCancel}
              loading={isCancelling}
            />
          </Section>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.h1,
    flexShrink: 1,
  },
});
