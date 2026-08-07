import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { isValidPhoneNumber, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { ChipSelect } from '../../components/chip-select';
import { CountrySelect } from '../../components/country-select';
import { DateInput } from '../../components/date-input';
import {
  colors,
  ErrorText,
  FormInput,
  LinkButton,
  PasswordInput,
  PrimaryButton,
} from '../../components/form';
import { spacing, typography } from '../../components/theme';
import { AFRICAN_COUNTRIES } from '../../lib/countries';
import { ApiError, type Sex } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { toIsoDateString } from '../../lib/date';
import { getCurrentLanguage } from '../../lib/i18n';

// Approximation cliente affichant le champ parent par anticipation — le seuil réel,
// configurable par pays (CountryPolicy), n'est tranché qu'au serveur (moteur de règles,
// jamais un seuil fixe côté client non plus).
function isLikelyMinor(dateOfBirth: Date): boolean {
  const now = new Date();
  let age = now.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = now.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dateOfBirth.getDate())) {
    age--;
  }
  return age < 18;
}

export default function RegisterScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { register } = useAuth();
  const SEX_OPTIONS: { value: Sex; label: string }[] = [
    { value: 'MALE', label: t('auth.register.male') },
    { value: 'FEMALE', label: t('auth.register.female') },
  ];
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [countryOfResidence, setCountryOfResidence] = useState<CountryCode | null>(null);
  const [phoneNational, setPhoneNational] = useState('');
  const [email, setEmail] = useState('');
  const [cityOfResidence, setCityOfResidence] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(null);
  const [parentPhoneNational, setParentPhoneNational] = useState('');
  const [ambassadorCode, setAmbassadorCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const likelyMinor = useMemo(
    () => (dateOfBirth ? isLikelyMinor(dateOfBirth) : false),
    [dateOfBirth],
  );

  const callingCode = useMemo(
    () => AFRICAN_COUNTRIES.find((c) => c.code === countryOfResidence)?.callingCode ?? null,
    [countryOfResidence],
  );

  const isPhoneValid = useMemo(
    () =>
      !!countryOfResidence &&
      !!phoneNational &&
      isValidPhoneNumber(phoneNational, countryOfResidence),
    [countryOfResidence, phoneNational],
  );

  const isParentPhoneValid = useMemo(() => {
    if (!parentPhoneNational) return true; // facultatif — orientation informative seulement
    return !!countryOfResidence && isValidPhoneNumber(parentPhoneNational, countryOfResidence);
  }, [countryOfResidence, parentPhoneNational]);

  const passwordsMatch = password.length > 0 && password === confirmPassword;

  async function handleSubmit() {
    setError(null);
    if (!dateOfBirth) {
      setError(t('auth.register.missingDob'));
      return;
    }
    if (!countryOfResidence) {
      setError(t('auth.register.missingCountry'));
      return;
    }
    if (!isPhoneValid) {
      setError(t('auth.register.invalidPhone'));
      return;
    }
    if (!passwordsMatch) {
      setError(t('auth.register.passwordMismatch'));
      return;
    }
    if (parentPhoneNational && !isParentPhoneValid) {
      setError(t('auth.register.invalidPhone'));
      return;
    }
    const phone = parsePhoneNumberFromString(phoneNational, countryOfResidence)?.number;
    if (!phone) {
      setError(t('auth.register.invalidPhone'));
      return;
    }
    const parentPhone =
      likelyMinor && parentPhoneNational
        ? parsePhoneNumberFromString(parentPhoneNational, countryOfResidence)?.number
        : undefined;

    setIsSubmitting(true);
    try {
      const result = await register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        sex: sex as Sex,
        phone,
        email: email.trim() || undefined,
        cityOfResidence: cityOfResidence.trim(),
        countryOfResidence,
        password,
        language: getCurrentLanguage().toUpperCase() as 'FR' | 'EN' | 'ES' | 'AR',
        dateOfBirth: toIsoDateString(dateOfBirth),
        parentPhone,
        ambassadorCode: ambassadorCode.trim() || undefined,
      });
      router.push({
        pathname: '/(auth)/verify-otp',
        params: {
          phone,
          message: result.message,
          // Transmis tel quel : l'écran suivant le traduit. Le rattachement n'a pas
          // pu être fait, l'utilisateur doit le savoir avant de croire le contraire.
          ambassadorAttribution: result.ambassadorAttribution ?? undefined,
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.register.genericError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit =
    !!firstName &&
    !!lastName &&
    !!sex &&
    !!cityOfResidence &&
    !!countryOfResidence &&
    isPhoneValid &&
    !!password &&
    passwordsMatch &&
    !!dateOfBirth &&
    isParentPhoneValid;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('auth.register.title')}</Text>

        <View style={styles.form}>
          <FormInput
            placeholder={t('auth.register.firstName')}
            value={firstName}
            onChangeText={setFirstName}
          />
          <FormInput
            placeholder={t('auth.register.lastName')}
            value={lastName}
            onChangeText={setLastName}
          />

          <ChipSelect options={SEX_OPTIONS} value={sex} onChange={(v) => setSex(v as Sex)} />

          <CountrySelect
            options={AFRICAN_COUNTRIES}
            value={countryOfResidence}
            onChange={setCountryOfResidence}
            placeholder={t('auth.register.countryPlaceholder')}
            searchPlaceholder={t('auth.register.countrySearchPlaceholder')}
          />

          <View style={styles.phoneRow}>
            <View style={styles.phonePrefix}>
              <Text style={styles.phonePrefixText}>{callingCode ? `+${callingCode}` : '+…'}</Text>
            </View>
            <FormInput
              style={styles.phoneInput}
              placeholder={t('auth.register.phoneNational')}
              value={phoneNational}
              onChangeText={setPhoneNational}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="phone-pad"
              editable={!!countryOfResidence}
            />
          </View>

          <FormInput
            placeholder={t('auth.register.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <FormInput
            placeholder={t('auth.register.city')}
            value={cityOfResidence}
            onChangeText={setCityOfResidence}
          />

          <PasswordInput
            placeholder={t('auth.register.password')}
            value={password}
            onChangeText={setPassword}
          />
          <PasswordInput
            placeholder={t('auth.register.confirmPassword')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          <DateInput
            placeholder={t('auth.register.dateOfBirth')}
            value={dateOfBirth}
            onChange={setDateOfBirth}
            maximumDate={new Date()}
          />

          {likelyMinor && (
            <>
              <Text style={styles.minorNotice}>{t('auth.register.minorNotice')}</Text>
              <View style={styles.phoneRow}>
                <View style={styles.phonePrefix}>
                  <Text style={styles.phonePrefixText}>{callingCode ? `+${callingCode}` : '+…'}</Text>
                </View>
                <FormInput
                  style={styles.phoneInput}
                  placeholder={t('auth.register.parentPhoneNational')}
                  value={parentPhoneNational}
                  onChangeText={setParentPhoneNational}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="phone-pad"
                  editable={!!countryOfResidence}
                />
              </View>
            </>
          )}

          {/* Champ facultatif, jamais bloquant : un code invalide est ignoré côté
              serveur plutôt que de faire échouer l'inscription. Le jeune perdrait son
              compte pour une raison qui ne le concerne pas. */}
          <Text style={styles.sectionLabel}>{t('auth.register.ambassadorCodeLabel')}</Text>
          <FormInput
            placeholder={t('auth.register.ambassadorCodePlaceholder')}
            value={ambassadorCode}
            onChangeText={setAmbassadorCode}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
          />
          <Text style={styles.ambassadorHint}>{t('auth.register.ambassadorCodeHint')}</Text>

          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title={t('auth.register.submit')}
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={!canSubmit}
          />
        </View>

        <LinkButton title={t('auth.register.haveAccount')} onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
    gap: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  form: {
    gap: 12,
  },
  minorNotice: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  sectionLabel: {
    ...typography.label,
    marginTop: spacing.sm,
  },
  ambassadorHint: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
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
