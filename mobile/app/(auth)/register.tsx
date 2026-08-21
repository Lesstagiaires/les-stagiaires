import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import {
  api,
  ApiError,
  type AgeThresholds,
  type Sex,
  type UserIntent,
} from '../../lib/api';
import {
  requiresParentalPhone,
  showsParentalField,
  tierForDateOfBirth,
} from '../../lib/age-tiers';
import { useAuth } from '../../lib/auth-context';
import { toIsoDateString } from '../../lib/date';
import { getCurrentLanguage } from '../../lib/i18n';

// Les seuils ne sont plus ici.
//
// Cet écran portait un « âge < 18 » codé en dur. Le Cameroun exige désormais un
// parent dès 14 ans, et le palier 18-20 propose un contact sans effet — deux
// choses qu'un booléen mineur/majeur ne peut pas dire. Les seuils viennent
// maintenant du serveur (`GET /auth/age-thresholds/:pays`) et le palier se
// calcule dans `lib/age-tiers`, à partir de ce qu'il a répondu.
//
// La date de naissance ne quitte pas l'appareil pour autant : on reçoit des
// SEUILS, pas un verdict.

export default function RegisterScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { register } = useAuth();
  // V6-2 — l'intention choisie sur l'accueil public. Lue en paramètre de route
  // plutôt que stockée : rien ne survit à l'écran, et il n'existe donc aucun
  // état temporaire à réconcilier si l'utilisateur revient en arrière.
  const { initialIntent } = useLocalSearchParams<{ initialIntent?: UserIntent }>();
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

  // Les seuils du pays choisi. Rechargés à chaque changement de pays : une
  // même date de naissance ne donne pas le même palier partout.
  const [thresholds, setThresholds] = useState<AgeThresholds | null>(null);

  useEffect(() => {
    if (!countryOfResidence) {
      setThresholds(null);
      return;
    }
    let annule = false;
    api
      .getAgeThresholds(countryOfResidence)
      .then((recus) => {
        if (!annule) setThresholds(recus);
      })
      // Réseau indisponible : on n'invente aucun seuil. Le champ parent
      // n'apparaît pas, et c'est le SERVEUR qui refusera l'inscription s'il
      // manque — mieux vaut un formulaire incomplet qu'un formulaire qui ment
      // sur ce qui est exigé.
      .catch(() => {
        if (!annule) setThresholds(null);
      });
    return () => {
      annule = true;
    };
  }, [countryOfResidence]);

  // Le palier courant. `null` tant qu'il manque la date ou les seuils : on
  // n'affiche rien plutôt que de deviner.
  const tier = useMemo(
    () =>
      dateOfBirth && thresholds
        ? tierForDateOfBirth(dateOfBirth, thresholds)
        : null,
    [dateOfBirth, thresholds],
  );

  const montreChampParent = tier ? showsParentalField(tier) : false;
  const parentObligatoire = tier ? requiresParentalPhone(tier) : false;

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
    // Au palier 14-17 le numéro est EXIGÉ : sans lui, aucun parent ne sera
    // jamais sollicité et le compte resterait restreint sans que l'utilisateur
    // comprenne pourquoi.
    if (!parentPhoneNational) return !parentObligatoire;
    return !!countryOfResidence && isValidPhoneNumber(parentPhoneNational, countryOfResidence);
  }, [countryOfResidence, parentPhoneNational, parentObligatoire]);

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
    // Le numéro du parent est EXIGÉ au palier 14-17 : sans lui, aucun parent
    // n'est jamais sollicité et le compte resterait restreint sans que
    // l'utilisateur comprenne pourquoi.
    if (parentObligatoire && !parentPhoneNational) {
      setError(t('auth.register.parentPhoneRequired'));
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
      montreChampParent && parentPhoneNational
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
        // Transmise telle quelle depuis l'accueil public. Absente si l'écran a
        // été atteint autrement — le serveur l'accepte, et le compte reste
        // parfaitement valide sans elle.
        initialIntent,
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

          {/*
            SOUS L'ÂGE MINIMUM : on l'explique, on ne bloque pas en silence.
            « afficher un message explicite plutôt qu'un blocage silencieux ».
            Le serveur refusera de toute façon ; l'écran doit dire pourquoi.
          */}
          {tier === 'BELOW_MINIMUM' && thresholds && (
            <Text style={styles.minorNotice}>
              {t('auth.register.tier.BELOW_MINIMUM', {
                age: thresholds.minInternshipAge,
              })}
            </Text>
          )}

          {montreChampParent && (
            <>
              {/*
                DEUX TEXTES DIFFÉRENTS pour deux paliers qui se ressemblent à
                l'écran. À 14-17 ans le numéro conditionne tout ; à 18-20 ans il
                n'a aucun effet, et le dire évite qu'un majeur croie devoir
                attendre une validation qui ne viendra jamais.
              */}
              <Text style={styles.minorNotice}>
                {tier === 'PARENTAL_CONSENT_REQUIRED'
                  ? t('auth.register.tier.PARENTAL_CONSENT_REQUIRED', {
                      age: thresholds?.civilMajorityAge,
                    })
                  : t('auth.register.tier.PARENTAL_INFO_OPTIONAL')}
              </Text>
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

        {/* Destination EXPLICITE, et non plus `router.back()`. Depuis V6-2, cet
            écran est atteint aussi bien depuis la connexion que depuis l'accueil
            public : revenir en arrière ramenait alors à l'accueil, alors que le
            libellé promet la connexion. */}
        <LinkButton
          title={t('auth.register.haveAccount')}
          onPress={() => router.replace('/(auth)/login')}
        />
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
