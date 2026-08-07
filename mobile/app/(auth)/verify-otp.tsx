import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, ErrorText, FormInput, PrimaryButton } from '../../components/form';
import { radius, spacing, typography } from '../../components/theme';
import { ApiError, type AmbassadorAttributionStatus } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

export default function VerifyOtpScreen() {
  const { phone, message, ambassadorAttribution } = useLocalSearchParams<{
    phone: string;
    message?: string;
    ambassadorAttribution?: AmbassadorAttributionStatus;
  }>();
  const { t } = useTranslation();
  const { verifyOtp } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      // La navigation vers l'écran d'accueil suit automatiquement : verifyOtp() met à
      // jour la session, et Stack.Protected (app/_layout.tsx) redirige dès que
      // accessToken devient non nul.
      await verifyOtp(phone, code.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.verifyOtp.genericError'));
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
        <Text style={styles.title}>{t('auth.verifyOtp.title')}</Text>
        <Text style={styles.subtitle}>
          {message ?? t('auth.verifyOtp.subtitleDefault', { phone })}
        </Text>

        {/* L'inscription a réussi : ceci n'est PAS une erreur, et n'en prend pas
            l'apparence. C'est un avertissement — le compte existe, seul le
            rattachement à un ambassadeur n'a pas eu lieu. Le dire ici évite que
            l'utilisateur croie son parrain enregistré (décision du promoteur du
            2026-08-01). ATTRIBUTED ne dit rien : un rattachement réussi est le
            comportement attendu, l'annoncer serait du bruit. */}
        {ambassadorAttribution &&
          ambassadorAttribution !== 'ATTRIBUTED' && (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                {t(`auth.verifyOtp.ambassador.${ambassadorAttribution}`)}
              </Text>
            </View>
          )}

        <View style={styles.form}>
          <FormInput
            placeholder={t('auth.verifyOtp.codePlaceholder')}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title={t('auth.verifyOtp.submit')}
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={code.length !== 6}
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
  notice: {
    backgroundColor: colors.accentLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  noticeText: {
    ...typography.caption,
    color: colors.accentDark,
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
