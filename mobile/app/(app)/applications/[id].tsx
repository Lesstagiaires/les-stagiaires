import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { Card } from '../../../components/card';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../components/form';
import { Section } from '../../../components/section';
import { colors, spacing, typography } from '../../../components/theme';
import {
  api,
  ApiError,
  type ApplicationArtifactKind,
  type ApplicationDetail,
  type DigitalSafeDocument,
} from '../../../lib/api';
import {
  useApplicationStatusLabels,
  APPLICATION_STATUS_TONE,
  useArtifactKindLabels,
} from '../../../lib/application-labels';
import { useAuth } from '../../../lib/auth-context';
import { saveFile } from '../../../lib/save-file';

export default function ApplicationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const applicationStatusLabels = useApplicationStatusLabels();

  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      setApplication(await api.getApplication(accessToken, id));
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('common.connectionError'));
    } finally {
      setIsLoading(false);
    }
  }, [id, accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !application || !accessToken || !id) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{loadError ?? t('applications.detail.notFound')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  const canWithdraw = [
    'SUBMITTED',
    'UNDER_REVIEW',
    'ADDITIONAL_DOCUMENT_REQUESTED',
    'INTERVIEW_PROPOSED',
    'INTERVIEW_CONFIRMED',
    'ADMISSION_LETTER_SENT',
    'AWAITING_TRAVEL_CONSENT',
    'ACCEPTED',
  ].includes(application.status);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Badge
            label={applicationStatusLabels[application.status]}
            tone={APPLICATION_STATUS_TONE[application.status]}
          />
          <Text style={styles.reference}>{application.reference}</Text>
        </View>
        <Text style={styles.title}>
          {application.opportunity?.title ?? t('applications.list.spontaneous')}
        </Text>
        <Text style={styles.organization}>{application.organization.name}</Text>

        {application.status === 'ADDITIONAL_DOCUMENT_REQUESTED' && (
          <DocumentRequestsSection
            accessToken={accessToken}
            applicationId={id}
            requests={application.documentRequests.filter((r) => r.status === 'PENDING')}
            onChanged={reload}
          />
        )}

        {application.status === 'INTERVIEW_PROPOSED' && (
          <InterviewSection accessToken={accessToken} applicationId={id} application={application} onChanged={reload} />
        )}

        {application.status === 'ADMISSION_LETTER_SENT' && (
          <AdmissionLetterSection accessToken={accessToken} applicationId={id} onChanged={reload} />
        )}

        {application.status === 'AWAITING_TRAVEL_CONSENT' && (
          <TravelConsentSection application={application} onChanged={reload} />
        )}

        {application.status === 'ACCEPTED' && (
          <SignatureSection
            accessToken={accessToken}
            applicationId={id}
            application={application}
            onChanged={reload}
          />
        )}

        {(application.status === 'ACCEPTED' || application.status === 'COMPLETED') && (
          <ReportSection accessToken={accessToken} applicationId={id} />
        )}

        {application.artifacts.length > 0 && (
          <ArtifactsSection
            accessToken={accessToken}
            applicationId={id}
            artifacts={application.artifacts}
          />
        )}

        <HistorySection history={application.history} />

        {canWithdraw && (
          <WithdrawButton accessToken={accessToken} applicationId={id} onChanged={reload} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// --- FR-M5-006 : compléments documentaires ------------------------------------------------

function DocumentRequestsSection({
  accessToken,
  applicationId,
  requests,
  onChanged,
}: {
  accessToken: string;
  applicationId: string;
  requests: ApplicationDetail['documentRequests'];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  if (requests.length === 0) return null;
  return (
    <Section title={t('applications.detail.documentRequest.sectionTitle')}>
      {requests.map((request) => (
        <FulfillRequestRow
          key={request.id}
          accessToken={accessToken}
          applicationId={applicationId}
          requestId={request.id}
          description={request.description}
          onChanged={onChanged}
        />
      ))}
    </Section>
  );
}

function FulfillRequestRow({
  accessToken,
  applicationId,
  requestId,
  description,
  onChanged,
}: {
  accessToken: string;
  applicationId: string;
  requestId: string;
  description: string;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFulfill(documentId: string) {
    setError(null);
    try {
      await api.fulfillDocumentRequest(accessToken, applicationId, requestId, documentId);
      setIsPicking(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('applications.detail.documentRequest.submitError'));
    }
  }

  return (
    <Card style={styles.innerCard}>
      <Text style={typography.body}>{description}</Text>
      {isPicking ? (
        <DigitalSafeDocumentPicker
          accessToken={accessToken}
          onSelect={handleFulfill}
          onCancel={() => setIsPicking(false)}
        />
      ) : (
        <SecondaryButton
          title={t('applications.detail.documentRequest.provideButton')}
          onPress={() => setIsPicking(true)}
        />
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

// --- FR-M5-007 : entretien -----------------------------------------------------------------

function InterviewSection({
  accessToken,
  applicationId,
  application,
  onChanged,
}: {
  accessToken: string;
  applicationId: string;
  application: ApplicationDetail;
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.confirmInterview(accessToken, applicationId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('applications.detail.interview.confirmError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title={t('applications.detail.interview.sectionTitle')}>
      {!!application.interviewProposedAt && (
        <Text style={typography.body}>
          {new Date(application.interviewProposedAt).toLocaleString(i18n.language)}
        </Text>
      )}
      {!!application.interviewMode && (
        <Text style={typography.caption}>
          {t('applications.detail.interview.modeLabel', { mode: application.interviewMode })}
        </Text>
      )}
      {!!application.interviewLocation && (
        <Text style={typography.caption}>
          {t('applications.detail.interview.locationLabel', {
            location: application.interviewLocation,
          })}
        </Text>
      )}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('applications.detail.interview.confirmButton')}
        onPress={handleConfirm}
        loading={isSubmitting}
      />
    </Section>
  );
}

// --- Lettre d'admission ---------------------------------------------------------------------

function AdmissionLetterSection({
  accessToken,
  applicationId,
  onChanged,
}: {
  accessToken: string;
  applicationId: string;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.acceptAdmissionLetter(accessToken, applicationId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('applications.detail.admissionLetter.acceptError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title={t('applications.detail.admissionLetter.sectionTitle')}>
      <Text style={typography.body}>{t('applications.detail.admissionLetter.hint')}</Text>
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('applications.detail.admissionLetter.acceptButton')}
        onPress={handleAccept}
        loading={isSubmitting}
      />
    </Section>
  );
}

// --- Accord parental de déplacement ---------------------------------------------------------

function TravelConsentSection({
  application,
  onChanged,
}: {
  application: ApplicationDetail;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const travelConsentId = application.travelConsent?.id;

  async function handleConfirm() {
    if (!travelConsentId) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await api.confirmTravelConsent(travelConsentId, code);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('applications.detail.travelConsent.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title={t('applications.detail.travelConsent.sectionTitle')}>
      <Text style={typography.body}>{t('applications.detail.travelConsent.hint')}</Text>
      <FormInput
        placeholder={t('applications.detail.travelConsent.codePlaceholder')}
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('applications.detail.travelConsent.confirmButton')}
        onPress={handleConfirm}
        loading={isSubmitting}
        disabled={!travelConsentId || code.length !== 6}
      />
    </Section>
  );
}

// --- Signature légère déclarative ----------------------------------------------------------

function SignatureSection({
  accessToken,
  applicationId,
  application,
  onChanged,
}: {
  accessToken: string;
  applicationId: string;
  application: ApplicationDetail;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadySigned = !!application.candidateSignedAt;
  const notSigned = t('applications.detail.signature.notSigned');

  async function handleSign() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.signApplication(accessToken, applicationId, name);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('applications.detail.signature.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title={t('applications.detail.signature.sectionTitle')}>
      <Text style={typography.caption}>
        {t('applications.detail.signature.youLabel')}
        {alreadySigned
          ? t('applications.detail.signature.signedBy', { name: application.candidateSignedName })
          : notSigned}
      </Text>
      <Text style={typography.caption}>
        {t('applications.detail.signature.companyLabel')}
        {application.organizationSignedAt
          ? t('applications.detail.signature.signedBy', {
              name: application.organizationSignedName,
            })
          : notSigned}
      </Text>
      {!alreadySigned && (
        <>
          <FormInput
            placeholder={t('applications.detail.signature.namePlaceholder')}
            value={name}
            onChangeText={setName}
          />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title={t('applications.detail.signature.signButton')}
            onPress={handleSign}
            loading={isSubmitting}
            disabled={!name.trim()}
          />
        </>
      )}
    </Section>
  );
}

// --- EDU-FR-007 : rapport de stage -----------------------------------------------------------

function ReportSection({
  accessToken,
  applicationId,
}: {
  accessToken: string;
  applicationId: string;
}) {
  const { t } = useTranslation();
  const [isPicking, setIsPicking] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(documentId: string) {
    setError(null);
    try {
      await api.submitInternshipReport(accessToken, applicationId, documentId);
      setIsPicking(false);
      setIsSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('applications.detail.report.error'));
    }
  }

  return (
    <Section title={t('applications.detail.report.sectionTitle')}>
      {isSubmitted ? (
        <Text style={typography.body}>{t('applications.detail.report.submitted')}</Text>
      ) : isPicking ? (
        <DigitalSafeDocumentPicker
          accessToken={accessToken}
          onSelect={handleSubmit}
          onCancel={() => setIsPicking(false)}
        />
      ) : (
        <SecondaryButton
          title={t('applications.detail.report.submitButton')}
          onPress={() => setIsPicking(true)}
        />
      )}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

// --- Sélecteur de document du Digital Safe (réutilisé pour compléments et rapport) --------

function DigitalSafeDocumentPicker({
  accessToken,
  onSelect,
  onCancel,
}: {
  accessToken: string;
  onSelect: (documentId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState<DigitalSafeDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api
        .listDocuments(accessToken)
        .then(setDocuments)
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : t('applications.detail.documentPicker.loadError')),
        );
    }, [accessToken, t]),
  );

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!documents) return <ActivityIndicator color={colors.primary} />;
  if (documents.length === 0) {
    return (
      <Text style={typography.caption}>{t('applications.detail.documentPicker.empty')}</Text>
    );
  }

  return (
    <View style={styles.pickerList}>
      {documents.map((document) => (
        <Pressable
          key={document.id}
          style={styles.pickerRow}
          onPress={() => onSelect(document.id)}
        >
          <Text style={typography.body}>{document.title}</Text>
          <Text style={typography.caption}>{document.latestVersion?.fileName}</Text>
        </Pressable>
      ))}
      <Pressable onPress={onCancel}>
        <Text style={styles.cancelText}>{t('common.cancel')}</Text>
      </Pressable>
    </View>
  );
}

// --- Artefacts (lettre, convention, attestation) -------------------------------------------

function ArtifactsSection({
  accessToken,
  applicationId,
  artifacts,
}: {
  accessToken: string;
  applicationId: string;
  artifacts: ApplicationDetail['artifacts'];
}) {
  const { t } = useTranslation();
  const artifactKindLabels = useArtifactKindLabels();
  const [downloadingKind, setDownloadingKind] = useState<ApplicationArtifactKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(kind: ApplicationArtifactKind) {
    setError(null);
    setDownloadingKind(kind);
    try {
      const { blob, fileName } = await api.downloadArtifact(accessToken, applicationId, kind);
      await saveFile(blob, fileName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('applications.detail.artifacts.downloadError'));
    } finally {
      setDownloadingKind(null);
    }
  }

  return (
    <Section title={t('applications.detail.artifacts.sectionTitle')}>
      {artifacts.map((artifact) => (
        <View key={artifact.id} style={styles.artifactRow}>
          <Text style={typography.body}>{artifactKindLabels[artifact.kind]}</Text>
          <Pressable onPress={() => handleDownload(artifact.kind)} hitSlop={8}>
            {downloadingKind === artifact.kind ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.downloadText}>{t('applications.detail.artifacts.download')}</Text>
            )}
          </Pressable>
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

// --- Historique -------------------------------------------------------------------------------

function HistorySection({ history }: { history: ApplicationDetail['history'] }) {
  const { t, i18n } = useTranslation();
  const applicationStatusLabels = useApplicationStatusLabels();
  return (
    <Section title={t('applications.detail.historyTitle')}>
      {history.map((event) => (
        <View key={event.id} style={styles.historyRow}>
          <Text style={typography.bodyBold}>{applicationStatusLabels[event.toStatus]}</Text>
          <Text style={typography.caption}>
            {new Date(event.createdAt).toLocaleString(i18n.language)}
          </Text>
          {!!event.note && <Text style={typography.caption}>{event.note}</Text>}
        </View>
      ))}
    </Section>
  );
}

// --- Retrait -------------------------------------------------------------------------------

function WithdrawButton({
  accessToken,
  applicationId,
  onChanged,
}: {
  accessToken: string;
  applicationId: string;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function performWithdraw() {
    setIsSubmitting(true);
    try {
      await api.withdrawApplication(accessToken, applicationId);
      await onChanged();
    } catch (err) {
      Alert.alert(
        t('applications.detail.withdraw.errorTitle'),
        err instanceof ApiError ? err.message : t('applications.detail.withdraw.error'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePress() {
    if (Platform.OS === 'web') {
      if (window.confirm(t('applications.detail.withdraw.confirmTitle'))) void performWithdraw();
      return;
    }
    Alert.alert(t('applications.detail.withdraw.confirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('applications.detail.withdraw.button'),
        style: 'destructive',
        onPress: () => void performWithdraw(),
      },
    ]);
  }

  return (
    <Pressable style={styles.withdrawButton} onPress={handlePress} disabled={isSubmitting}>
      <Text style={styles.withdrawText}>
        {isSubmitting
          ? t('applications.detail.withdraw.inProgress')
          : t('applications.detail.withdraw.button')}
      </Text>
    </Pressable>
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
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reference: {
    ...typography.caption,
  },
  title: {
    ...typography.h1,
    marginTop: spacing.xs,
  },
  organization: {
    ...typography.body,
    color: colors.textSecondary,
  },
  innerCard: {
    gap: spacing.sm,
  },
  pickerList: {
    gap: spacing.xs,
  },
  pickerRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cancelText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  artifactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  downloadText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  historyRow: {
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  withdrawButton: {
    marginTop: spacing.lg,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  withdrawText: {
    ...typography.bodyBold,
    color: colors.error,
  },
});
