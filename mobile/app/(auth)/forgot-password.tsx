import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isValidPhoneNumber, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { CountrySelect } from '../../components/country-select';
import { colors, ErrorText, FormInput, LinkButton, PrimaryButton } from '../../components/form';
import { AFRICAN_COUNTRIES } from '../../lib/countries';
import { api, ApiError } from '../../lib/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [country, setCountry] = useState<CountryCode | null>(null);
  const [phoneNational, setPhoneNational] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const callingCode = useMemo(
    () => AFRICAN_COUNTRIES.find((c) => c.code === country)?.callingCode ?? null,
    [country],
  );

  const isPhoneValid = useMemo(
    () => !!country && !!phoneNational && isValidPhoneNumber(phoneNational, country),
    [country, phoneNational],
  );

  async function handleSubmit() {
    setError(null);
    if (!country) {
      setError(t('auth.forgotPassword.missingCountry'));
      return;
    }
    if (!isPhoneValid) {
      setError(t('auth.forgotPassword.invalidPhone'));
      return;
    }
    const phone = parsePhoneNumberFromString(phoneNational, country)?.number;
    if (!phone) {
      setError(t('auth.forgotPassword.invalidPhone'));
      return;
    }
    setIsSubmitting(true);
    try {
      // Réponse générique qu'un compte existe ou non pour ce numéro (CLAUDE.md §2 —
      // pas d'énumération de comptes) : on avance systématiquement vers l'écran de
      // saisie du code plutôt que de révéler quoi que ce soit ici.
      await api.forgotPassword(phone);
      router.push({
        pathname: '/(auth)/reset-password',
        params: { phone },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.forgotPassword.genericError'));
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
        <Text style={styles.title}>{t('auth.forgotPassword.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.forgotPassword.subtitle')}</Text>

        <View style={styles.form}>
          <CountrySelect
            options={AFRICAN_COUNTRIES}
            value={country}
            onChange={setCountry}
            placeholder={t('auth.forgotPassword.countryPlaceholder')}
            searchPlaceholder={t('auth.forgotPassword.countrySearchPlaceholder')}
          />

          <View style={styles.phoneRow}>
            <View style={styles.phonePrefix}>
              <Text style={styles.phonePrefixText}>{callingCode ? `+${callingCode}` : '+…'}</Text>
            </View>
            <FormInput
              style={styles.phoneInput}
              placeholder={t('auth.forgotPassword.phoneNational')}
              value={phoneNational}
              onChangeText={setPhoneNational}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="phone-pad"
              editable={!!country}
            />
          </View>

          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title={t('auth.forgotPassword.submit')}
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={!country || !isPhoneValid}
          />
        </View>

        <LinkButton title={t('auth.forgotPassword.back')} onPress={() => router.back()} />
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
  phoneRow: {
    flexDirection: 'row',
    gap: 8,
  },
  phonePrefix: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  phonePrefixText: {
    fontSize: 16,
    color: colors.text,
  },
  phoneInput: {
    flex: 1,
  },
});
