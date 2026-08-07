import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, radius, shadow, spacing, typography } from './theme';

// Réexporté pour compatibilité : les écrans existants importent `colors` depuis ce
// fichier plutôt que directement depuis theme.ts.
export { colors };

export function FormInput({ style, ...props }: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      style={[styles.input, style]}
      {...props}
    />
  );
}

export function PasswordInput({ style, ...props }: TextInputProps) {
  const [isVisible, setIsVisible] = useState(false);
  return (
    <View style={styles.passwordWrapper}>
      <TextInput
        placeholderTextColor={colors.muted}
        secureTextEntry={!isVisible}
        style={[styles.input, styles.passwordInput, style]}
        {...props}
      />
      <Pressable
        onPress={() => setIsVisible((current) => !current)}
        hitSlop={8}
        style={styles.passwordToggle}
      >
        <Ionicons
          name={isVisible ? 'eye-off-outline' : 'eye-outline'}
          size={20}
          color={colors.muted}
        />
      </Pressable>
    </View>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <Text style={styles.error} accessibilityRole="alert">
      {children}
    </Text>
  );
}

export function PrimaryButton({
  title,
  onPress,
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || loading;
  // Ink Deep sur dégradé Ember→Gold plutôt que du blanc : le blanc sur Ember n'atteint
  // que 2.4:1 de contraste (échoue WCAG AA), Ink Deep sur ce dégradé atteint 7.6:1 — voir
  // la section Accessibilité de l'artifact "Direction artistique « Le Passeport »".
  if (isDisabled) {
    return (
      <Pressable disabled style={[styles.button, styles.buttonDisabled]}>
        {loading ? (
          <ActivityIndicator color={colors.graphiteMute} />
        ) : (
          <Text style={styles.buttonTextDisabled}>{title}</Text>
        )}
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.buttonPressed]}>
      <LinearGradient
        colors={[colors.accent, colors.gold]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.button}
      >
        {loading ? (
          <ActivityIndicator color={colors.inkDeep} />
        ) : (
          <Text style={styles.buttonText}>{title}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function SecondaryButton({
  title,
  onPress,
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.secondaryButton,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.secondaryButtonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Text style={styles.secondaryButtonText}>{title}</Text>
      )}
    </Pressable>
  );
}

export function LinkButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={styles.link}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  passwordWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: spacing.lg * 2 + 20,
  },
  passwordToggle: {
    position: 'absolute',
    right: spacing.lg,
  },
  error: {
    color: colors.error,
    backgroundColor: colors.errorLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    fontSize: 13,
    fontWeight: '600',
  },
  button: {
    borderRadius: radius.sm,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
  },
  buttonDisabled: {
    backgroundColor: colors.mist,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    fontFamily: fonts.bodyBold,
    color: colors.inkDeep,
    fontSize: 16,
    fontWeight: '700',
  },
  buttonTextDisabled: {
    fontFamily: fonts.bodyBold,
    color: colors.graphiteMute,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonPressed: {
    backgroundColor: colors.border,
  },
  secondaryButtonText: {
    ...typography.bodyBold,
    color: colors.primaryDark,
  },
  link: {
    fontFamily: fonts.bodySemiBold,
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
