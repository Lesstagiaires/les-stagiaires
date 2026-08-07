import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Badge } from '../../../components/badge';
import { Card } from '../../../components/card';
import { EmptyState } from '../../../components/empty-state';
import { colors, ErrorText } from '../../../components/form';
import { fonts, radius, spacing, typography } from '../../../components/theme';
import {
  COMMISSION_STATUS_TONE,
  useCommissionNatureLabels,
  useCommissionStatusLabels,
} from '../../../lib/ambassador-labels';
import { api, ApiError, type Commission } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { formatAmountMinor } from '../../../lib/money';
import { useSubscriptionPlanLabels } from '../../../lib/subscription-labels';

export default function CommissionsScreen() {
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const statusLabels = useCommissionStatusLabels();
  const natureLabels = useCommissionNatureLabels();
  const planLabels = useSubscriptionPlanLabels();

  const [commissions, setCommissions] = useState<Commission[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      setCommissions(await api.getMyCommissions(accessToken));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : t('ambassador.commissions.loadError'),
      );
    }
  }, [accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!accessToken) return null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t('ambassador.commissions.intro')}</Text>

        {commissions === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : commissions.length === 0 ? (
          <EmptyState message={t('ambassador.commissions.empty')} />
        ) : (
          <View style={styles.list}>
            {commissions.map((commission) => (
              <Card key={commission.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Badge
                    label={statusLabels[commission.status]}
                    tone={COMMISSION_STATUS_TONE[commission.status]}
                  />
                  <Text style={typography.caption}>
                    {new Date(commission.createdAt).toLocaleDateString(
                      i18n.language,
                    )}
                  </Text>
                </View>

                <Text style={styles.amount}>
                  {formatAmountMinor(
                    commission.amountMinor,
                    commission.currency,
                    i18n.language,
                  )}
                </Text>

                {/* Le détail du calcul est affiché, pas seulement le résultat. Un
                    ambassadeur doit pouvoir refaire l'opération de tête : assiette,
                    taux, montant. C'est aussi ce qui rend un désaccord discutable
                    plutôt que subi. */}
                <Text style={styles.breakdown}>
                  {formatAmountMinor(
                    commission.basisAmountMinor,
                    commission.currency,
                    i18n.language,
                  )}
                  {' × '}
                  {(commission.rateBasisPoints / 100).toLocaleString(
                    i18n.language,
                  )}
                  {' %'}
                </Text>

                <View style={styles.metaRow}>
                  <Text style={typography.caption}>
                    {planLabels[
                      commission.productKey as keyof typeof planLabels
                    ] ?? commission.productKey}
                  </Text>
                  <Text style={typography.caption}>
                    {natureLabels[commission.nature]}
                  </Text>
                </View>

                {/* Une commission en attente porte sa date d'exigibilité : « pourquoi
                    ne puis-je pas retirer cette somme ? » doit se répondre sans
                    contacter le support. */}
                {commission.status === 'PENDING' && (
                  <Text style={styles.pendingHint}>
                    {t('ambassador.commissions.availableOn', {
                      date: new Date(
                        commission.securityPeriodEndsAt,
                      ).toLocaleDateString(i18n.language),
                    })}
                  </Text>
                )}
              </Card>
            ))}
          </View>
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
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  intro: {
    ...typography.body,
    color: colors.textSecondary,
  },
  loader: {
    marginTop: spacing.xxl,
  },
  list: {
    gap: spacing.md,
  },
  card: {
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amount: {
    fontFamily: fonts.mono,
    fontSize: 24,
    color: colors.text,
    marginTop: spacing.xs,
  },
  breakdown: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.muted,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  pendingHint: {
    ...typography.caption,
    color: colors.accentDark,
    backgroundColor: colors.accentLight,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
});
