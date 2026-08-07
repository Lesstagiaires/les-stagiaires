import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, ErrorText, FormInput, PasswordInput, PrimaryButton } from '../../components/form';
import { api, ApiError } from '../../lib/api';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  async function handleSubmit() {
    setError(null);
    if (!passwordsMatch) {
      setError(t('auth.resetPassword.passwordMismatch'));
      return;
    }
    setIsSubmitting(true);
    try {
      await api.resetPassword(phone, code.trim(), newPassword);
      // resetPassword() révoque tous les refresh tokens côté serveur — l'utilisateur doit
      // se reconnecter explicitement avec le nouveau mot de passe, pas de session auto.
      router.replace({
        pathname: '/(auth)',
        params: { message: t('auth.resetPassword.successMessage') },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.resetPassword.genericError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.title}>{t('auth.resetPassword.title')}</Text>
        <Text style={styles.subtitle}>
          {t('auth.resetPassword.subtitleDefault', { phone })}
        </Text>

        <View style={styles.form}>
          <FormInput
            placeholder={t('auth.resetPassword.codePlaceholder')}
            value={code}
            onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
          />
          <PasswordInput
            placeholder={t('auth.resetPassword.newPassword')}
            value={newPassword}
            onChangeText={setNewPassword}
          />
          <PasswordInput
            placeholder={t('auth.resetPassword.confirmPassword')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title={t('auth.resetPassword.submit')}
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={code.length !== 6 || !newPassword || !passwordsMatch}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  form: {
    gap: 12,
  },
});
