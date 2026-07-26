import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, ErrorText, FormInput, LinkButton, PrimaryButton } from '../../components/form';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

export default function LoginScreen() {
  const router = useRouter();
  const { login, completeTwoFactorLogin } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await login(identifier.trim(), password);
      if (result.requiresTwoFactor && result.challengeToken) {
        setChallengeToken(result.challengeToken);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Connexion impossible. Vérifiez votre connexion internet.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyTwoFactor() {
    if (!challengeToken) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await completeTwoFactorLogin(challengeToken, code);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Vérification impossible.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (challengeToken) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={styles.title}>Double authentification</Text>
          <Text style={styles.subtitle}>
            Un code a été envoyé par SMS à votre numéro. Saisissez-le pour terminer la
            connexion.
          </Text>

          <View style={styles.form}>
            <FormInput
              placeholder="Code à 6 chiffres"
              value={code}
              onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
            />
            <ErrorText>{error}</ErrorText>
            <PrimaryButton
              title="Vérifier"
              onPress={handleVerifyTwoFactor}
              loading={isSubmitting}
              disabled={code.length !== 6}
            />
          </View>

          <LinkButton title="Retour" onPress={() => setChallengeToken(null)} />
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.title}>LES STAGIAIRES</Text>
        <Text style={styles.subtitle}>Connectez-vous à votre compte</Text>

        <View style={styles.form}>
          <FormInput
            placeholder="Téléphone (ex: +237670000000) ou email"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <FormInput
            placeholder="Mot de passe"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title="Se connecter"
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={!identifier || !password}
          />
        </View>

        <LinkButton
          title="Pas encore de compte ? Inscrivez-vous"
          onPress={() => router.push('/(auth)/register')}
        />
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
    fontSize: 28,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
    marginTop: -16,
  },
  form: {
    gap: 12,
  },
});
