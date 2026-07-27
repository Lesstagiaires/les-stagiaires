import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Opportunity } from '../lib/api';
import { useOpportunityTypeLabels, useWorkModeLabels } from '../lib/opportunity-labels';
import { useOrganizationVerificationLabels } from '../lib/organization-labels';
import { Badge } from './badge';
import { PressableCard } from './card';
import { colors, radius, spacing, typography } from './theme';

export function OpportunityCard({
  opportunity,
  onPress,
  isFavorite,
  onToggleFavorite,
  compact = false,
}: {
  opportunity: Opportunity;
  onPress: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  compact?: boolean;
}) {
  const opportunityTypeLabels = useOpportunityTypeLabels();
  const workModeLabels = useWorkModeLabels();
  const organizationVerificationLabels = useOrganizationVerificationLabels();
  return (
    <PressableCard onPress={onPress} style={compact ? styles.compactCard : styles.card}>
      <View style={styles.header}>
        <Badge label={opportunityTypeLabels[opportunity.type]} tone="primary" />
        {onToggleFavorite && (
          <Pressable
            onPress={(event) => {
              event.stopPropagation?.();
              onToggleFavorite();
            }}
            hitSlop={8}
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={22}
              color={isFavorite ? colors.accentDark : colors.muted}
            />
          </Pressable>
        )}
      </View>

      <Text style={styles.title} numberOfLines={compact ? 2 : 1}>
        {opportunity.title}
      </Text>
      <Text style={styles.organization} numberOfLines={1}>
        {opportunity.organization.name}
        {opportunity.organization.verificationStatus === 'VERIFIED' && (
          <Text style={styles.verified}>  ✓ {organizationVerificationLabels.VERIFIED}</Text>
        )}
      </Text>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="location-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText}>
            {opportunity.city}, {opportunity.country}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="briefcase-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText}>{workModeLabels[opportunity.workMode]}</Text>
        </View>
      </View>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  compactCard: {
    width: 260,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...typography.h3,
  },
  organization: {
    ...typography.caption,
  },
  verified: {
    color: colors.success,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderRadius: radius.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    ...typography.caption,
  },
});
