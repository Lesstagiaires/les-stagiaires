import Svg, { Circle, Path } from 'react-native-svg';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from './form';
import { colors, spacing, typography } from './theme';

// Illustration unique, cohérente sur tous les écrans vides plutôt qu'une simple ligne de
// texte grisée — trait unique marine + accent ember, sans photographie de stock (voir
// artifact "Direction artistique « Le Passeport »", section Illustration & icônes).
function EmptyIllustration() {
  return (
    <Svg width={72} height={60} viewBox="0 0 120 100" fill="none">
      <Path
        d="M20 80 L20 30 L60 15 L100 30 L100 80"
        stroke={colors.primary}
        strokeWidth={3}
        strokeLinejoin="round"
        fill="none"
      />
      <Circle cx={60} cy={50} r={10} stroke={colors.accent} strokeWidth={3} fill="none" />
      <Path
        d="M55 50 L65 50 M60 45 L60 55"
        stroke={colors.accent}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// Composant partagé pour tous les écrans vides — remplace les `<Text>` isolés dispersés
// dans chaque écran. Ne jamais laisser un écran vide silencieux : illustration + message,
// et une action de retour possible quand il y en a une évidente (voir §"Ce qu'on refuse
// de faire" de l'artifact : jamais un silence).
export function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.container}>
      <EmptyIllustration />
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction && (
        <View style={styles.action}>
          <PrimaryButton title={actionLabel} onPress={onAction} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  message: {
    ...typography.caption,
    textAlign: 'center',
    maxWidth: 260,
  },
  action: {
    marginTop: spacing.xs,
    alignSelf: 'stretch',
  },
});
