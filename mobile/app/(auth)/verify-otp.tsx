import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, ErrorText, FormInput, PrimaryButton } from '../../components/form';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

export default function VerifyOtpScreen() {
  const { phone, message } = useLocalSearchParams<{
    phone: string;
    message?: string;
  }>();
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
      setError(
        err instanceof ApiError
          ? err.message
          : 'Vérification impossible. Vérifiez votre connexion internet.',
      );
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
        <Text style={styles.title}>Vérification du téléphone</Text>
        <Text style={styles.subtitle}>
          {message ?? `Un code a été envoyé par SMS au ${phone}.`}
        </Text>

        <View style={styles.form}>
          <FormInput
            placeholder="Code à 6 chiffres"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title="Valider"
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
