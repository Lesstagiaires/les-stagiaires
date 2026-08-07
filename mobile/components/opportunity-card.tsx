import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Opportunity } from '../lib/api';
import {
  useMatchReasonLabels,
  useOpportunityTypeLabels,
  useWorkModeLabels,
} from '../lib/opportunity-labels';
import { useOrganizationVerificationLabels } from '../lib/organization-labels';
import { Badge } from './badge';
import { PressableCard } from './card';
import { colors, radius, spacing, typography } from './theme';

// Largeur d'une carte compacte + l'espacement du carrousel — utilisé par l'écran
// d'accueil pour calculer les positions de défilement automatique (une carte à la fois).
export const OPPORTUNITY_CARD_STRIDE = 260 + spacing.md;

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
  const matchReasonLabels = useMatchReasonLabels();

  // Les motifs ne s'affichent pas sur une carte compacte : le carrousel
  // d'accueil ne classe rien, il montre les dernières offres. Y afficher
  // « correspond à vos compétences » serait faux.
  const reasons = compact ? [] : (opportunity.matchReasons ?? []);
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

      {/*
        POURQUOI cette offre vous est proposée — jamais à quel point.

        Le candidat voit des motifs, pas un score : « le candidat finirait par
        vouloir jouer l'algorithme ». Et des motifs GÉNÉRIQUES, qui ne lui
        réapprennent rien sur lui-même que quelqu'un lisant par-dessus son
        épaule pourrait retenir.
      */}
      {reasons.length > 0 && (
        <View style={styles.reasons}>
          {reasons.map((reason) => (
            <View key={reason} style={styles.reason}>
              <Ionicons name="checkmark-circle" size={13} color={colors.success} />
              <Text style={styles.reasonText}>{matchReasonLabels[reason]}</Text>
            </View>
          ))}
        </View>
      )}
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
  reasons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
  },
  reasonText: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '600',
  },
});
