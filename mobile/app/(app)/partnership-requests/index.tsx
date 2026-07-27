import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { ChipSelect } from '../../../components/chip-select';
import { PressableCard } from '../../../components/card';
import { ErrorText } from '../../../components/form';
import { colors, spacing, typography } from '../../../components/theme';
import { api, ApiError, type PartnershipRequest, type PartnershipRequestStatus } from '../../../lib/api';
import {
  PARTNERSHIP_STATUS_TONE,
  usePartnershipReasonLabels,
  usePartnershipStatusLabels,
} from '../../../lib/partnership-request-labels';
import { useAuth } from '../../../lib/auth-context';

type StatusFilter = PartnershipRequestStatus | '__all__';

export default function PartnershipRequestsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const partnershipStatusLabels = usePartnershipStatusLabels();
  const partnershipReasonLabels = usePartnershipReasonLabels();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('NEW');
  const [requests, setRequests] = useState<PartnershipRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusFilterOptions: { value: StatusFilter; label: string }[] = [
    { value: '__all__', label: t('partnershipRequests.filterAll') },
    ...(Object.keys(partnershipStatusLabels) as PartnershipRequestStatus[]).map((status) => ({
      value: status,
      label: partnershipStatusLabels[status],
    })),
  ];

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const status = statusFilter === '__all__' ? undefined : statusFilter;
      setRequests(await api.listPartnershipRequests(accessToken, { status }));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      if (err instanceof ApiError && err.statusCode === 403) {
        setError(t('partnershipRequests.unavailable'));
        return;
      }
      setError(err instanceof ApiError ? err.message : t('partnershipRequests.loadError'));
    }
  }, [accessToken, logout, statusFilter, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!accessToken) return null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ChipSelect
            options={statusFilterOptions}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
          />
        </ScrollView>

        {requests === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : requests.length === 0 ? (
          <Text style={styles.emptyText}>{t('partnershipRequests.empty')}</Text>
        ) : (
          <View style={styles.list}>
            {requests.map((request) => (
              <PressableCard
                key={request.id}
                style={styles.card}
                onPress={() => router.push(`/partnership-requests/${request.id}`)}
              >
                <View style={styles.cardHeader}>
                  <Badge
                    label={partnershipStatusLabels[request.status]}
                    tone={PARTNERSHIP_STATUS_TONE[request.status]}
                  />
                  <Text style={typography.caption}>
                    {new Date(request.createdAt).toLocaleDateString(i18n.language)}
                  </Text>
                </View>
                <Text style={styles.organizationName} numberOfLines={1}>
                  {request.organizationName}
                </Text>
                <Text style={typography.caption}>{partnershipReasonLabels[request.reason]}</Text>
                <Text style={typography.caption}>
                  {t('partnershipRequests.contactLabel', { name: request.contactName })}
                </Text>
                {request.assignedTo && (
                  <Text style={typography.caption}>
                    {t('partnershipRequests.assignedLabel', {
                      name: request.assignedTo.lsId ?? request.assignedTo.id,
                    })}
                  </Text>
                )}
              </PressableCard>
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
  emptyText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xl,
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
  organizationName: {
    ...typography.h3,
    marginTop: spacing.xs,
  },
});
