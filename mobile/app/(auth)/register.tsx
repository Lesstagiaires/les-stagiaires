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
import { ChipSelect } from '../../components/chip-select';
import { DateInput } from '../../components/date-input';
import { colors, ErrorText, FormInput, LinkButton, PrimaryButton } from '../../components/form';
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
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cityOfResidence, setCityOfResidence] = useState('');
  const [countryOfResidence, setCountryOfResidence] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(null);
  const [parentPhone, setParentPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const likelyMinor = useMemo(
    () => (dateOfBirth ? isLikelyMinor(dateOfBirth) : false),
    [dateOfBirth],
  );

  async function handleSubmit() {
    setError(null);
    if (!dateOfBirth) {
      setError(t('auth.register.missingDob'));
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        sex: sex as Sex,
        phone: phone.trim(),
        email: email.trim() || undefined,
        cityOfResidence: cityOfResidence.trim(),
        countryOfResidence: countryOfResidence.trim().toUpperCase(),
        password,
        language: getCurrentLanguage().toUpperCase() as 'FR' | 'EN' | 'ES' | 'AR',
        dateOfBirth: toIsoDateString(dateOfBirth),
        parentPhone: likelyMinor ? parentPhone.trim() || undefined : undefined,
      });
      router.push({
        pathname: '/(auth)/verify-otp',
        params: { phone: phone.trim(), message: result.message },
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
    !!phone &&
    !!cityOfResidence &&
    countryOfResidence.trim().length === 2 &&
    !!password &&
    !!dateOfBirth;

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

          <FormInput
            placeholder={t('auth.register.phone')}
            value={phone}
            onChangeText={setPhone}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
          />
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
          <FormInput
            placeholder={t('auth.register.country')}
            value={countryOfResidence}
            onChangeText={(text) => setCountryOfResidence(text.toUpperCase().slice(0, 2))}
            autoCapitalize="characters"
            maxLength={2}
          />

          <FormInput
            placeholder={t('auth.register.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
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
              <FormInput
                placeholder={t('auth.register.parentPhone')}
                value={parentPhone}
                onChangeText={setParentPhone}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="phone-pad"
              />
            </>
          )}

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
});
