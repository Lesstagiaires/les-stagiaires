import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChipSelect } from '../../../components/chip-select';
import { ErrorText, FormInput, PrimaryButton } from '../../../components/form';
import { Card } from '../../../components/card';
import { colors, spacing, typography } from '../../../components/theme';
import {
  api,
  ApiError,
  type Opportunity,
  type OpportunityAlert,
  type OpportunityType,
} from '../../../lib/api';
import { useOpportunityTypeLabels, useOpportunityTypeOptions } from '../../../lib/opportunity-labels';
import { useAuth } from '../../../lib/auth-context';
import { EmptyState } from '../../../components/empty-state';

export default function AlertsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const [alerts, setAlerts] = useState<OpportunityAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      setAlerts(await api.listAlerts(accessToken));
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('opportunities.alerts.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, logout]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!accessToken) return null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hint}>{t('opportunities.alerts.hint')}</Text>

        <CreateAlertForm accessToken={accessToken} onCreated={reload} />

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : loadError ? (
          <ErrorText>{loadError}</ErrorText>
        ) : alerts.length === 0 ? (
          <EmptyState message={t('opportunities.alerts.noAlerts')} />
        ) : (
          alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              accessToken={accessToken}
              alert={alert}
              onChanged={reload}
              onOpenOpportunity={(id) => router.push(`/opportunities/${id}`)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CreateAlertForm({
  accessToken,
  onCreated,
}: {
  accessToken: string;
  onCreated: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const opportunityTypeOptions = useOpportunityTypeOptions();
  const [isOpen, setIsOpen] = useState(false);
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [sector, setSector] = useState('');
  const [type, setType] = useState<OpportunityType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    setIsSaving(true);
    try {
      await api.createAlert(accessToken, {
        country: country || undefined,
        city: city || undefined,
        sector: sector || undefined,
        type: type ?? undefined,
      });
      setCountry('');
      setCity('');
      setSector('');
      setType(null);
      setIsOpen(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opportunities.alerts.createError'));
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) {
    return (
      <Pressable onPress={() => setIsOpen(true)}>
        <Text style={styles.addText}>{t('opportunities.alerts.createLink')}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.form}>
      <FormInput
        placeholder={t('opportunities.search.countryPlaceholder')}
        value={country}
        onChangeText={setCountry}
      />
      <FormInput
        placeholder={t('opportunities.search.cityPlaceholder')}
        value={city}
        onChangeText={setCity}
      />
      <FormInput
        placeholder={t('opportunities.search.sectorPlaceholder')}
        value={sector}
        onChangeText={setSector}
      />
      <ChipSelect
        options={[
          { value: '__all__', label: t('opportunities.search.allTypes') },
          ...opportunityTypeOptions,
        ]}
        value={type ?? '__all__'}
        onChange={(value) => setType(value === '__all__' ? null : (value as OpportunityType))}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('opportunities.alerts.createButton')}
        onPress={handleCreate}
        loading={isSaving}
      />
      <Pressable onPress={() => setIsOpen(false)}>
        <Text style={styles.cancelText}>{t('common.cancel')}</Text>
      </Pressable>
    </View>
  );
}

function AlertCard({
  accessToken,
  alert,
  onChanged,
  onOpenOpportunity,
}: {
  accessToken: string;
  alert: OpportunityAlert;
  onChanged: () => Promise<void>;
  onOpenOpportunity: (id: string) => void;
}) {
  const { t } = useTranslation();
  const opportunityTypeLabels = useOpportunityTypeLabels();
  const [isRemoving, setIsRemoving] = useState(false);
  const [matches, setMatches] = useState<Opportunity[] | null>(null);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);

  const criteriaLabel = [
    alert.type ? opportunityTypeLabels[alert.type] : null,
    alert.sector,
    alert.city,
    alert.country,
  ]
    .filter(Boolean)
    .join(' · ');

  async function handleRemove() {
    setIsRemoving(true);
    try {
      await api.removeAlert(accessToken, alert.id);
      await onChanged();
    } catch {
      setIsRemoving(false);
    }
  }

  async function handleToggleMatches() {
    if (matches !== null) {
      setMatches(null);
      return;
    }
    setIsLoadingMatches(true);
    try {
      setMatches(await api.getAlertMatches(accessToken, alert.id));
    } catch {
      setMatches([]);
    } finally {
      setIsLoadingMatches(false);
    }
  }

  return (
    <Card style={styles.alertCard}>
      <View style={styles.alertHeader}>
        <Text style={styles.alertCriteria}>
          {criteriaLabel || t('opportunities.alerts.allOffers')}
        </Text>
        <Pressable onPress={handleRemove} disabled={isRemoving} hitSlop={8}>
          <Text style={styles.removeText}>{isRemoving ? '…' : t('common.remove')}</Text>
        </Pressable>
      </View>

      <Pressable onPress={handleToggleMatches}>
        <Text style={styles.matchesToggle}>
          {matches === null
            ? t('opportunities.alerts.showMatches')
            : t('opportunities.alerts.hideMatches')}
        </Text>
      </Pressable>

      {isLoadingMatches && <ActivityIndicator color={colors.primary} />}

      {matches !== null && !isLoadingMatches && (
        <View style={styles.matchesList}>
          {matches.length === 0 ? (
            <EmptyState message={t('opportunities.alerts.noMatches')} />
          ) : (
            matches.map((match) => (
              <Pressable
                key={match.id}
                style={styles.matchRow}
                onPress={() => onOpenOpportunity(match.id)}
              >
                <Text style={styles.matchTitle} numberOfLines={1}>
                  {match.title}
                </Text>
                <Text style={styles.matchSubtitle}>{match.organization.name}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}
    </Card>
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
  hint: {
    ...typography.caption,
  },
  form: {
    gap: spacing.sm,
  },
  addText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  cancelText: {
    ...typography.caption,
    textAlign: 'center',
  },
  loader: {
    marginTop: spacing.xl,
  },
  alertCard: {
    gap: spacing.sm,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  alertCriteria: {
    ...typography.bodyBold,
    flex: 1,
  },
  removeText: {
    ...typography.caption,
    color: colors.error,
  },
  matchesToggle: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  matchesList: {
    gap: spacing.xs,
  },
  matchRow: {
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  matchTitle: {
    ...typography.body,
  },
  matchSubtitle: {
    ...typography.caption,
  },
});
