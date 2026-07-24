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
import { OPPORTUNITY_TYPE_LABELS, OPPORTUNITY_TYPE_OPTIONS } from '../../../lib/opportunity-labels';
import { useAuth } from '../../../lib/auth-context';

export default function AlertsScreen() {
  const router = useRouter();
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
      setLoadError(err instanceof ApiError ? err.message : 'Chargement impossible.');
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
        <Text style={styles.hint}>
          Créez une alerte pour être notifié des nouvelles offres correspondant à vos
          critères.
        </Text>

        <CreateAlertForm accessToken={accessToken} onCreated={reload} />

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : loadError ? (
          <ErrorText>{loadError}</ErrorText>
        ) : alerts.length === 0 ? (
          <Text style={styles.emptyText}>Aucune alerte pour l'instant.</Text>
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
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) {
    return (
      <Pressable onPress={() => setIsOpen(true)}>
        <Text style={styles.addText}>+ Créer une alerte</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.form}>
      <FormInput placeholder="Pays" value={country} onChangeText={setCountry} />
      <FormInput placeholder="Ville" value={city} onChangeText={setCity} />
      <FormInput placeholder="Secteur" value={sector} onChangeText={setSector} />
      <ChipSelect
        options={[{ value: '__all__', label: 'Tous les types' }, ...OPPORTUNITY_TYPE_OPTIONS]}
        value={type ?? '__all__'}
        onChange={(value) => setType(value === '__all__' ? null : (value as OpportunityType))}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title="Créer l'alerte" onPress={handleCreate} loading={isSaving} />
      <Pressable onPress={() => setIsOpen(false)}>
        <Text style={styles.cancelText}>Annuler</Text>
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
  const [isRemoving, setIsRemoving] = useState(false);
  const [matches, setMatches] = useState<Opportunity[] | null>(null);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);

  const criteriaLabel = [
    alert.type ? OPPORTUNITY_TYPE_LABELS[alert.type] : null,
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
        <Text style={styles.alertCriteria}>{criteriaLabel || 'Toutes les offres'}</Text>
        <Pressable onPress={handleRemove} disabled={isRemoving} hitSlop={8}>
          <Text style={styles.removeText}>{isRemoving ? '…' : 'Supprimer'}</Text>
        </Pressable>
      </View>

      <Pressable onPress={handleToggleMatches}>
        <Text style={styles.matchesToggle}>
          {matches === null ? 'Voir les offres correspondantes' : 'Masquer'}
        </Text>
      </Pressable>

      {isLoadingMatches && <ActivityIndicator color={colors.primary} />}

      {matches !== null && !isLoadingMatches && (
        <View style={styles.matchesList}>
          {matches.length === 0 ? (
            <Text style={styles.emptyText}>Aucune correspondance pour l'instant.</Text>
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
  emptyText: {
    ...typography.caption,
    textAlign: 'center',
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
