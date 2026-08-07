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
import { daysUntil, portfolioUrgencyTone } from '../../../lib/ambassador-labels';
import { api, ApiError, type PortfolioEntry } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';

export default function PortfolioScreen() {
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();

  const [entries, setEntries] = useState<PortfolioEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      setEntries(await api.getMyPortfolio(accessToken));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(
        err instanceof ApiError ? err.message : t('ambassador.portfolio.loadError'),
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
        {/* La règle est énoncée en toutes lettres, en haut de l'écran. Un ambassadeur
            qui perd une entreprise ne doit jamais découvrir la règle à ce moment-là :
            elle est devant lui à chaque consultation. */}
        <View style={styles.rule}>
          <Text style={styles.ruleTitle}>
            {t('ambassador.portfolio.ruleTitle')}
          </Text>
          <Text style={styles.ruleBody}>{t('ambassador.portfolio.ruleBody')}</Text>
        </View>

        {entries === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : entries.length === 0 ? (
          <EmptyState message={t('ambassador.portfolio.empty')} />
        ) : (
          <View style={styles.list}>
            {entries.map((entry) => {
              const daysLeft = daysUntil(entry.expiresAt);
              return (
                <Card key={entry.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.orgName}>{entry.organization.name}</Text>
                    <Badge
                      label={t('ambassador.portfolio.daysLeft', {
                        count: daysLeft,
                      })}
                      tone={portfolioUrgencyTone(daysLeft)}
                    />
                  </View>

                  <Text style={typography.caption}>
                    {[entry.organization.sector, entry.organization.city]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>

                  <View style={styles.dateRow}>
                    <Text style={styles.dateLabel}>
                      {t('ambassador.portfolio.lastPurchase')}
                    </Text>
                    <Text style={styles.dateValue}>
                      {entry.lastConfirmedPurchaseAt
                        ? new Date(
                            entry.lastConfirmedPurchaseAt,
                          ).toLocaleDateString(i18n.language)
                        : t('ambassador.portfolio.neverPurchased')}
                    </Text>
                  </View>

                  <View style={styles.dateRow}>
                    <Text style={styles.dateLabel}>
                      {t('ambassador.portfolio.expiresAt')}
                    </Text>
                    <Text style={styles.dateValue}>
                      {new Date(entry.expiresAt).toLocaleDateString(i18n.language)}
                    </Text>
                  </View>
                </Card>
              );
            })}
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
  rule: {
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  ruleTitle: {
    ...typography.label,
    color: colors.primaryDark,
  },
  ruleBody: {
    ...typography.caption,
    color: colors.textSecondary,
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
    gap: spacing.sm,
  },
  orgName: {
    ...typography.h3,
    flex: 1,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  dateLabel: {
    ...typography.label,
  },
  dateValue: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.text,
  },
});
