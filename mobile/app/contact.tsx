import { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChipSelect } from '../components/chip-select';
import { colors, ErrorText, FormInput, PrimaryButton } from '../components/form';
import { spacing, typography } from '../components/theme';
import {
  api,
  ApiError,
  type PartnershipRequestOrgType,
  type PartnershipRequestReason,
} from '../lib/api';
import {
  usePartnershipOrgTypeOptions,
  usePartnershipReasonOptions,
} from '../lib/partnership-request-labels';

export default function ContactScreen() {
  const { t } = useTranslation();
  const orgTypeOptions = usePartnershipOrgTypeOptions();
  const reasonOptions = usePartnershipReasonOptions();

  const [organizationName, setOrganizationName] = useState('');
  const [organizationType, setOrganizationType] = useState<PartnershipRequestOrgType | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactTitle, setContactTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [reason, setReason] = useState<PartnershipRequestReason | null>(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const canSubmit =
    !!organizationName.trim() &&
    !!organizationType &&
    !!contactName.trim() &&
    !!phone.trim() &&
    !!email.trim() &&
    !!country.trim() &&
    !!reason &&
    !!subject.trim() &&
    description.trim().length >= 10;

  async function handleSubmit() {
    if (!organizationType || !reason) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await api.submitPartnershipRequest({
        organizationName,
        organizationType,
        contactName,
        contactTitle: contactTitle.trim() || undefined,
        phone,
        email,
        country,
        city: city.trim() || undefined,
        reason,
        subject,
        description,
      });
      setIsSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('contact.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSubmitted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.successTitle}>{t('contact.successTitle')}</Text>
          <Text style={styles.successBody}>{t('contact.successBody')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('contact.title')}</Text>
        <Text style={styles.intro}>{t('contact.intro')}</Text>

        <FormInput
          placeholder={t('contact.organizationNamePlaceholder')}
          value={organizationName}
          onChangeText={setOrganizationName}
        />

        <View style={styles.field}>
          <Text style={typography.label}>{t('contact.organizationTypeLabel')}</Text>
          <ChipSelect
            options={orgTypeOptions}
            value={organizationType}
            onChange={(value) => setOrganizationType(value as PartnershipRequestOrgType)}
          />
        </View>

        <FormInput
          placeholder={t('contact.contactNamePlaceholder')}
          value={contactName}
          onChangeText={setContactName}
        />
        <FormInput
          placeholder={t('contact.contactTitlePlaceholder')}
          value={contactTitle}
          onChangeText={setContactTitle}
        />
        <FormInput
          placeholder={t('contact.phonePlaceholder')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <FormInput
          placeholder={t('contact.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <FormInput
          placeholder={t('contact.countryPlaceholder')}
          value={country}
          onChangeText={setCountry}
        />
        <FormInput
          placeholder={t('contact.cityPlaceholder')}
          value={city}
          onChangeText={setCity}
        />

        <View style={styles.field}>
          <Text style={typography.label}>{t('contact.reasonLabel')}</Text>
          <ChipSelect
            options={reasonOptions}
            value={reason}
            onChange={(value) => setReason(value as PartnershipRequestReason)}
          />
        </View>

        <FormInput
          placeholder={t('contact.subjectPlaceholder')}
          value={subject}
          onChangeText={setSubject}
        />
        <FormInput
          placeholder={t('contact.descriptionPlaceholder')}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
          style={styles.multiline}
        />

        <ErrorText>{error}</ErrorText>
        <PrimaryButton
          title={t('contact.submit')}
          onPress={handleSubmit}
          loading={isSubmitting}
          disabled={!canSubmit}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  title: {
    ...typography.h1,
  },
  intro: {
    ...typography.body,
    color: colors.textSecondary,
  },
  field: {
    gap: spacing.sm,
  },
  multiline: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  successTitle: {
    ...typography.h1,
    textAlign: 'center',
  },
  successBody: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textSecondary,
  },
});
