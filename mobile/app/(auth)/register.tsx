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
import { DateInput } from '../../components/date-input';
import { colors, ErrorText, FormInput, LinkButton, PrimaryButton } from '../../components/form';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

// Année-mois-jour LOCAUX plutôt que toISOString() (conversion UTC) : envoyer la date
// de naissance ainsi évite qu'elle recule d'un jour dans un fuseau horaire à l'est
// d'UTC (ex. WAT/UTC+1 au Cameroun), ce qui fausserait le calcul serveur de la
// majorité (CLAUDE.md §5). "YYYY-MM-DD" est un ISO 8601 valide pour @IsDateString().
function toIsoDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeIsMinor(dateOfBirth: Date): boolean {
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
  const { register } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(null);
  const [parentPhone, setParentPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Calculé côté client dès la saisie de la date de naissance, pour afficher le champ
  // parent AVANT la soumission — la même règle est réappliquée côté serveur
  // (FR-AUTH-004a), le client ne fait qu'anticiper l'UX, jamais l'unique garde-fou.
  const isMinor = useMemo(
    () => (dateOfBirth ? computeIsMinor(dateOfBirth) : false),
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
        phone: phone.trim(),
        password,
        language: 'FR',
        dateOfBirth: toIsoDateString(dateOfBirth),
        parentPhone: isMinor ? parentPhone.trim() : undefined,
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
    !!phone && !!password && !!dateOfBirth && (!isMinor || !!parentPhone);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Créer un compte</Text>

        <View style={styles.form}>
          <FormInput
            placeholder="Téléphone (ex: +237670000000)"
            value={phone}
            onChangeText={setPhone}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
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

          {isMinor && (
            <>
              <Text style={styles.minorNotice}>
                Un compte pour un compte mineur nécessite le numéro d'un
                parent ou tuteur, qui recevra un SMS pour donner son accord.
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
