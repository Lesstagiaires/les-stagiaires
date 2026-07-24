import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from './theme';

export type Tone = 'primary' | 'accent' | 'neutral' | 'error';

const TONE_STYLES: Record<Tone, { bg: string; fg: string }> = {
  primary: { bg: colors.primaryLight, fg: colors.primaryDark },
  accent: { bg: colors.accentLight, fg: colors.accentDark },
  neutral: { bg: colors.surfaceAlt, fg: colors.textSecondary },
  error: { bg: colors.errorLight, fg: colors.error },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const toneStyle = TONE_STYLES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: toneStyle.bg }]}>
      <Text style={[styles.text, { color: toneStyle.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
});
