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
import {
  colors,
  ErrorText,
  FormInput,
  PrimaryButton,
} from '../../../components/form';
import { fonts, radius, spacing, typography } from '../../../components/theme';
import {
  PAYOUT_STATUS_TONE,
  usePayoutStatusLabels,
} from '../../../lib/ambassador-labels';
import {
  api,
  ApiError,
  type MyAmbassador,
  type PayoutRequest,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { formatAmountMinor } from '../../../lib/money';

export default function PayoutsScreen() {
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const statusLabels = usePayoutStatusLabels();

  const [ambassador, setAmbassador] = useState<MyAmbassador | null>(null);
  const [payouts, setPayouts] = useState<PayoutRequest[] | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [me, list] = await Promise.all([
        api.getMyAmbassador(accessToken),
        api.listMyPayouts(accessToken),
      ]);
      setAmbassador(me);
      setPayouts(list);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(
        err instanceof ApiError ? err.message : t('ambassador.payouts.loadError'),
      );
    }
  }, [accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Le montant est saisi en francs, converti en unité mineure pour l'API. La conversion
  // est faite ici et nulle part ailleurs — le serveur revérifie de toute façon le solde
  // disponible et le minimum applicable au pays.
  const amountMinor = Math.round(Number(amount.replace(',', '.')) * 100);
  const canSubmit =
    Number.isFinite(amountMinor) &&
    amountMinor > 0 &&
    method.trim().length >= 3 &&
    destinationLabel.trim().length >= 3;

  async function handleSubmit() {
    if (!accessToken || !canSubmit) return;
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      await api.requestPayout(accessToken, {
        amountMinor,
        method: method.trim(),
        destinationLabel: destinationLabel.trim(),
      });
      setAmount('');
      setMethod('');
      setDestinationLabel('');
      setSuccess(t('ambassador.payouts.requested'));
      await reload();
    } catch (err) {
      // Les refus de verrou (contrat non signé, pays fermé, montant sous le minimum)
      // remontent tels quels : le message du serveur est plus précis que tout message
      // générique qu'on pourrait écrire ici.
      setError(
        err instanceof ApiError ? err.message : t('ambassador.payouts.error'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!accessToken) return null;

  const wallet = ambassador?.wallet;
  const currency = wallet?.currency ?? 'XAF';
  const contractSigned = Boolean(ambassador?.contractSignedAt);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.availablePanel}>
          <Text style={styles.availableLabel}>
            {t('ambassador.balance.available')}
          </Text>
          <Text style={styles.availableValue}>
            {formatAmountMinor(
              wallet?.availableMinor ?? 0,
              currency,
              i18n.language,
            )}
          </Text>
        </View>

        {/* Le verrou contractuel remplace le formulaire plutôt que de le laisser
            échouer à la soumission : proposer un formulaire qu'on sait voué au refus
            fait perdre du temps et de la confiance. */}
        {!contractSigned ? (
          <View style={styles.lockNotice}>
            <Text style={styles.lockTitle}>
              {t('ambassador.payouts.lockedTitle')}
            </Text>
            <Text style={styles.lockBody}>
              {t('ambassador.payouts.lockedBody')}
            </Text>
          </View>
        ) : (
          <View style={styles.form}>
            <Text style={typography.label}>
              {t('ambassador.payouts.amountLabel', { currency })}
            </Text>
            <FormInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
            />

            <Text style={typography.label}>
              {t('ambassador.payouts.methodLabel')}
            </Text>
            <FormInput
              value={method}
              onChangeText={setMethod}
              placeholder={t('ambassador.payouts.methodPlaceholder')}
            />

            <Text style={typography.label}>
              {t('ambassador.payouts.destinationLabel')}
            </Text>
            <FormInput
              value={destinationLabel}
              onChangeText={setDestinationLabel}
              placeholder={t('ambassador.payouts.destinationPlaceholder')}
            />
            {/* CLAUDE.md §6 : ni numéro complet, ni code PIN. Le dire explicitement à
                l'utilisateur évite qu'il le saisisse de lui-même. */}
            <Text style={styles.privacyHint}>
              {t('ambassador.payouts.privacyHint')}
            </Text>

            <PrimaryButton
              title={t('ambassador.payouts.submit')}
              onPress={() => void handleSubmit()}
              disabled={!canSubmit}
              loading={isSubmitting}
            />
          </View>
        )}

        {error && <ErrorText>{error}</ErrorText>}
        {success && <Text style={styles.success}>{success}</Text>}

        <Text style={typography.h3}>{t('ambassador.payouts.historyTitle')}</Text>

        {payouts === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : payouts.length === 0 ? (
          <EmptyState message={t('ambassador.payouts.empty')} />
        ) : (
          <View style={styles.list}>
            {payouts.map((payout) => (
              <Card key={payout.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Badge
                    label={statusLabels[payout.status]}
                    tone={PAYOUT_STATUS_TONE[payout.status]}
                  />
                  <Text style={typography.caption}>
                    {new Date(payout.requestedAt).toLocaleDateString(
                      i18n.language,
                    )}
                  </Text>
                </View>
                <Text style={styles.payoutAmount}>
                  {formatAmountMinor(
                    payout.amountMinor,
                    payout.currency,
                    i18n.language,
                  )}
                </Text>
                <Text style={typography.caption}>{payout.destinationLabel}</Text>
                {payout.rejectionReason && (
                  <Text style={styles.rejection}>{payout.rejectionReason}</Text>
                )}
                {payout.executionReference && (
                  <Text style={styles.reference}>
                    {t('ambassador.payouts.reference', {
                      reference: payout.executionReference,
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
  loader: {
    marginTop: spacing.xxl,
  },
  availablePanel: {
    backgroundColor: colors.inkDeep,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.xs,
  },
  availableLabel: {
    ...typography.label,
    color: colors.graphiteMute,
  },
  availableValue: {
    fontFamily: fonts.mono,
    fontSize: 30,
    color: colors.gold,
  },
  lockNotice: {
    backgroundColor: colors.accentLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  lockTitle: {
    ...typography.bodyBold,
    color: colors.accentDark,
  },
  lockBody: {
    ...typography.caption,
    color: colors.accentDark,
  },
  form: {
    gap: spacing.sm,
  },
  privacyHint: {
    ...typography.caption,
    color: colors.muted,
  },
  success: {
    ...typography.caption,
    color: colors.success,
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
  payoutAmount: {
    fontFamily: fonts.mono,
    fontSize: 20,
    color: colors.text,
  },
  rejection: {
    ...typography.caption,
    color: colors.error,
  },
  reference: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
  },
});
