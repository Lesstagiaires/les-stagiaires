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
import { Badge } from '../../components/badge';
import { Card } from '../../components/card';
import { ChipSelect } from '../../components/chip-select';
import { EmptyState } from '../../components/empty-state';
import {
  colors,
  ErrorText,
  FormInput,
  PrimaryButton,
  SecondaryButton,
} from '../../components/form';
import { fonts, radius, spacing, typography } from '../../components/theme';
import {
  AMBASSADOR_STATUS_TONE,
  PAYOUT_STATUS_TONE,
  useAmbassadorStatusLabels,
  usePayoutStatusLabels,
} from '../../lib/ambassador-labels';
import {
  api,
  ApiError,
  type Ambassador,
  type PayoutRequest,
} from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { formatAmountMinor } from '../../lib/money';

type Tab = 'ambassadors' | 'payouts';

export default function AmbassadorsAdminScreen() {
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const statusLabels = useAmbassadorStatusLabels();
  const payoutStatusLabels = usePayoutStatusLabels();

  const [tab, setTab] = useState<Tab>('ambassadors');
  const [ambassadors, setAmbassadors] = useState<Ambassador[] | null>(null);
  const [payouts, setPayouts] = useState<PayoutRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Motif de rejet, saisi par demande — obligatoire côté serveur : un ambassadeur doit
  // toujours savoir pourquoi son versement a été refusé.
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [executionRefs, setExecutionRefs] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [ambassadorList, payoutList] = await Promise.all([
        api.listAmbassadors(accessToken),
        api.listAllPayouts(accessToken),
      ]);
      setAmbassadors(ambassadorList);
      setPayouts(payoutList);
      setError(null);
    } catch (err) {
      // Toujours sortir de l'état « chargement », même en erreur — sinon le spinner
      // tourne indéfiniment au lieu d'afficher le message.
      setAmbassadors([]);
      setPayouts([]);
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      if (err instanceof ApiError && err.statusCode === 403) {
        setError(t('ambassadorsAdmin.unavailable'));
        return;
      }
      setError(
        err instanceof ApiError ? err.message : t('ambassadorsAdmin.loadError'),
      );
    }
  }, [accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function runAction(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t('ambassadorsAdmin.actionError'),
      );
    } finally {
      setBusyId(null);
    }
  }

  if (!accessToken) return null;

  const tabOptions = [
    { value: 'ambassadors', label: t('ambassadorsAdmin.tabAmbassadors') },
    { value: 'payouts', label: t('ambassadorsAdmin.tabPayouts') },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ChipSelect
          options={tabOptions}
          value={tab}
          onChange={(value) => setTab(value as Tab)}
        />

        {error && <ErrorText>{error}</ErrorText>}

        {tab === 'ambassadors' ? (
          ambassadors === null ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : ambassadors.length === 0 ? (
            <EmptyState message={t('ambassadorsAdmin.emptyAmbassadors')} />
          ) : (
            <View style={styles.list}>
              {ambassadors.map((ambassador) => (
                <Card key={ambassador.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.code}>{ambassador.code}</Text>
                    <Badge
                      label={statusLabels[ambassador.status]}
                      tone={AMBASSADOR_STATUS_TONE[ambassador.status]}
                    />
                  </View>

                  <Text style={typography.caption}>
                    {ambassador.countryCode} · {ambassador.categories.join(' · ')}
                  </Text>

                  {/* Le verrou contractuel est le premier fait affiché à
                      l'administration : c'est lui qui décide si un versement pourra
                      un jour partir vers cette personne. */}
                  <View style={styles.contractRow}>
                    <Text style={typography.label}>
                      {t('ambassadorsAdmin.contract')}
                    </Text>
                    <Text
                      style={[
                        styles.contractValue,
                        !ambassador.contractSignedAt && styles.contractMissing,
                      ]}
                    >
                      {ambassador.contractSignedAt
                        ? new Date(
                            ambassador.contractSignedAt,
                          ).toLocaleDateString(i18n.language)
                        : t('ambassadorsAdmin.contractMissing')}
                    </Text>
                  </View>

                  {ambassador.wallet && (
                    <Text style={styles.wallet}>
                      {t('ambassadorsAdmin.walletSummary', {
                        available: formatAmountMinor(
                          ambassador.wallet.availableMinor,
                          ambassador.wallet.currency,
                          i18n.language,
                        ),
                        pending: formatAmountMinor(
                          ambassador.wallet.pendingMinor,
                          ambassador.wallet.currency,
                          i18n.language,
                        ),
                      })}
                    </Text>
                  )}

                  <View style={styles.actions}>
                    {ambassador.status === 'PENDING' && (
                      <PrimaryButton
                        title={t('ambassadorsAdmin.approve')}
                        loading={busyId === ambassador.id}
                        onPress={() =>
                          void runAction(ambassador.id, () =>
                            api.approveAmbassador(accessToken, ambassador.id),
                          )
                        }
                      />
                    )}
                    {ambassador.status === 'SUSPENDED' && (
                      <SecondaryButton
                        title={t('ambassadorsAdmin.reinstate')}
                        loading={busyId === ambassador.id}
                        onPress={() =>
                          void runAction(ambassador.id, () =>
                            api.reinstateAmbassador(accessToken, ambassador.id),
                          )
                        }
                      />
                    )}
                  </View>
                </Card>
              ))}
            </View>
          )
        ) : payouts === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : payouts.length === 0 ? (
          <EmptyState message={t('ambassadorsAdmin.emptyPayouts')} />
        ) : (
          <View style={styles.list}>
            {payouts.map((payout) => (
              <Card key={payout.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.payoutAmount}>
                    {formatAmountMinor(
                      payout.amountMinor,
                      payout.currency,
                      i18n.language,
                    )}
                  </Text>
                  <Badge
                    label={payoutStatusLabels[payout.status]}
                    tone={PAYOUT_STATUS_TONE[payout.status]}
                  />
                </View>

                <Text style={typography.caption}>
                  {payout.method} · {payout.destinationLabel}
                </Text>

                {/* Deux étapes distinctes, jamais fusionnées : valider, c'est
                    autoriser ; exécuter, c'est constater qu'un virement est parti.
                    Le virement lui-même se fait hors application (CLAUDE.md §6). */}
                {payout.status === 'REQUESTED' && (
                  <View style={styles.actions}>
                    <PrimaryButton
                      title={t('ambassadorsAdmin.validate')}
                      loading={busyId === payout.id}
                      onPress={() =>
                        void runAction(payout.id, () =>
                          api.validatePayout(accessToken, payout.id),
                        )
                      }
                    />
                  </View>
                )}

                {payout.status === 'VALIDATED' && (
                  <View style={styles.actions}>
                    <Text style={typography.label}>
                      {t('ambassadorsAdmin.executionReference')}
                    </Text>
                    <FormInput
                      value={executionRefs[payout.id] ?? ''}
                      onChangeText={(value) =>
                        setExecutionRefs((current) => ({
                          ...current,
                          [payout.id]: value,
                        }))
                      }
                      placeholder={t('ambassadorsAdmin.executionPlaceholder')}
                    />
                    <PrimaryButton
                      title={t('ambassadorsAdmin.markExecuted')}
                      loading={busyId === payout.id}
                      disabled={(executionRefs[payout.id] ?? '').trim().length < 3}
                      onPress={() =>
                        void runAction(payout.id, () =>
                          api.executePayout(
                            accessToken,
                            payout.id,
                            (executionRefs[payout.id] ?? '').trim(),
                          ),
                        )
                      }
                    />
                  </View>
                )}

                {(payout.status === 'REQUESTED' ||
                  payout.status === 'VALIDATED') && (
                  <View style={styles.actions}>
                    <FormInput
                      value={rejectReasons[payout.id] ?? ''}
                      onChangeText={(value) =>
                        setRejectReasons((current) => ({
                          ...current,
                          [payout.id]: value,
                        }))
                      }
                      placeholder={t('ambassadorsAdmin.rejectPlaceholder')}
                    />
                    <SecondaryButton
                      title={t('ambassadorsAdmin.reject')}
                      loading={busyId === payout.id}
                      disabled={
                        (rejectReasons[payout.id] ?? '').trim().length < 10
                      }
                      onPress={() =>
                        void runAction(payout.id, () =>
                          api.rejectPayout(
                            accessToken,
                            payout.id,
                            (rejectReasons[payout.id] ?? '').trim(),
                          ),
                        )
                      }
                    />
                  </View>
                )}

                {payout.executionReference && (
                  <Text style={styles.reference}>
                    {payout.executionReference}
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
  code: {
    fontFamily: fonts.mono,
    fontSize: 18,
    color: colors.text,
    letterSpacing: 2,
  },
  contractRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  contractValue: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.text,
  },
  contractMissing: {
    color: colors.error,
  },
  wallet: {
    ...typography.caption,
    backgroundColor: colors.paper,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  payoutAmount: {
    fontFamily: fonts.mono,
    fontSize: 20,
    color: colors.text,
  },
  reference: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
  },
});
