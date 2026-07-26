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
import { ChipSelect } from '../../components/chip-select';
import { DateInput } from '../../components/date-input';
import { colors, ErrorText, FormInput, LinkButton, PrimaryButton } from '../../components/form';
import { ApiError, type Sex } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { toIsoDateString } from '../../lib/date';

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

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'MALE', label: 'Homme' },
  { value: 'FEMALE', label: 'Femme' },
];

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
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
      setError('Indiquez votre date de naissance.');
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
        language: 'FR',
        dateOfBirth: toIsoDateString(dateOfBirth),
        parentPhone: likelyMinor ? parentPhone.trim() || undefined : undefined,
      });
      router.push({
        pathname: '/(auth)/verify-otp',
        params: { phone: phone.trim(), message: result.message },
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Inscription impossible. Vérifiez votre connexion internet.',
      );
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
        <Text style={styles.title}>Créer un compte</Text>

        <View style={styles.form}>
          <FormInput placeholder="Prénom" value={firstName} onChangeText={setFirstName} />
          <FormInput placeholder="Nom" value={lastName} onChangeText={setLastName} />

          <ChipSelect options={SEX_OPTIONS} value={sex} onChange={(v) => setSex(v as Sex)} />

          <FormInput
            placeholder="Téléphone (ex: +237670000000)"
            value={phone}
            onChangeText={setPhone}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
          />
          <FormInput
            placeholder="Email (facultatif)"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <FormInput
            placeholder="Ville de résidence"
            value={cityOfResidence}
            onChangeText={setCityOfResidence}
          />
          <FormInput
            placeholder="Pays de résidence (code, ex : CM)"
            value={countryOfResidence}
            onChangeText={(text) => setCountryOfResidence(text.toUpperCase().slice(0, 2))}
            autoCapitalize="characters"
            maxLength={2}
          />

          <FormInput
            placeholder="Mot de passe (10 caractères min., majuscule, minuscule, chiffre)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <DateInput
            placeholder="Date de naissance"
            value={dateOfBirth}
            onChange={setDateOfBirth}
            maximumDate={new Date()}
          />

          {likelyMinor && (
            <>
              <Text style={styles.minorNotice}>
                Selon votre pays de résidence, un compte de cet âge peut nécessiter le
                numéro d'un parent ou tuteur, qui recevra un SMS pour donner son accord.
              </Text>
              <FormInput
                placeholder="Téléphone du parent/tuteur"
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
            title="S'inscrire"
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={!canSubmit}
          />
        </View>

        <LinkButton title="Déjà un compte ? Connectez-vous" onPress={() => router.back()} />
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
