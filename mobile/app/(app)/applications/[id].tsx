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
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONE,
  ARTIFACT_KIND_LABELS,
} from '../../../lib/application-labels';
import { useAuth } from '../../../lib/auth-context';
import { saveFile } from '../../../lib/save-file';

export default function ApplicationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, logout } = useAuth();

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
      setLoadError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    } finally {
      setIsLoading(false);
    }
  }, [id, accessToken, logout]);

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
          <ErrorText>{loadError ?? 'Candidature indisponible.'}</ErrorText>
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
            label={APPLICATION_STATUS_LABELS[application.status]}
            tone={APPLICATION_STATUS_TONE[application.status]}
          />
          <Text style={styles.reference}>{application.reference}</Text>
        </View>
        <Text style={styles.title}>
          {application.opportunity?.title ?? 'Candidature spontanée'}
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
  if (requests.length === 0) return null;
  return (
    <Section title="Document complémentaire demandé">
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
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFulfill(documentId: string) {
    setError(null);
    try {
      await api.fulfillDocumentRequest(accessToken, applicationId, requestId, documentId);
      setIsPicking(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
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
        <SecondaryButton title="Fournir un document" onPress={() => setIsPicking(true)} />
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.confirmInterview(accessToken, applicationId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Confirmation impossible.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title="Entretien proposé">
      {!!application.interviewProposedAt && (
        <Text style={typography.body}>
          {new Date(application.interviewProposedAt).toLocaleString('fr-FR')}
        </Text>
      )}
      {!!application.interviewMode && (
        <Text style={typography.caption}>Mode : {application.interviewMode}</Text>
      )}
      {!!application.interviewLocation && (
        <Text style={typography.caption}>Lieu : {application.interviewLocation}</Text>
      )}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title="Confirmer l'entretien" onPress={handleConfirm} loading={isSubmitting} />
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.acceptAdmissionLetter(accessToken, applicationId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Acceptation impossible.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title="Lettre d'admission reçue">
      <Text style={typography.body}>
        Félicitations ! Acceptez votre lettre d'admission pour poursuivre.
      </Text>
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title="Accepter la lettre d'admission"
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
      setError(err instanceof ApiError ? err.message : 'Code invalide ou expiré.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title="Accord parental de déplacement">
      <Text style={typography.body}>
        Un SMS a été envoyé à votre parent/tuteur avec un code à 6 chiffres. Demandez-le
        lui et saisissez-le ci-dessous pour confirmer l'accord de déplacement.
      </Text>
      <FormInput
        placeholder="Code à 6 chiffres"
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title="Confirmer l'accord"
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
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadySigned = !!application.candidateSignedAt;

  async function handleSign() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.signApplication(accessToken, applicationId, name);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Signature impossible.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title="Signature de la convention">
      <Text style={typography.caption}>
        Vous : {alreadySigned ? `signé par ${application.candidateSignedName}` : 'non signé'}
      </Text>
      <Text style={typography.caption}>
        Entreprise :{' '}
        {application.organizationSignedAt
          ? `signé par ${application.organizationSignedName}`
          : 'non signé'}
      </Text>
      {!alreadySigned && (
        <>
          <FormInput placeholder="Votre nom complet" value={name} onChangeText={setName} />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title="Signer la convention"
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
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    }
  }

  return (
    <Section title="Rapport de stage">
      {isSubmitted ? (
        <Text style={typography.body}>Rapport déposé.</Text>
      ) : isPicking ? (
        <DigitalSafeDocumentPicker
          accessToken={accessToken}
          onSelect={handleSubmit}
          onCancel={() => setIsPicking(false)}
        />
      ) : (
        <SecondaryButton
          title="Déposer mon rapport de stage"
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
  const [documents, setDocuments] = useState<DigitalSafeDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api
        .listDocuments(accessToken)
        .then(setDocuments)
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Chargement impossible.'));
    }, [accessToken]),
  );

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!documents) return <ActivityIndicator color={colors.primary} />;
  if (documents.length === 0) {
    return (
      <Text style={typography.caption}>
        Aucun document dans votre coffre-fort — ajoutez-en un depuis l'onglet Coffre-fort.
      </Text>
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
        <Text style={styles.cancelText}>Annuler</Text>
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
  const [downloadingKind, setDownloadingKind] = useState<ApplicationArtifactKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(kind: ApplicationArtifactKind) {
    setError(null);
    setDownloadingKind(kind);
    try {
      const { blob, fileName } = await api.downloadArtifact(accessToken, applicationId, kind);
      await saveFile(blob, fileName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Téléchargement impossible.');
    } finally {
      setDownloadingKind(null);
    }
  }

  return (
    <Section title="Documents">
      {artifacts.map((artifact) => (
        <View key={artifact.id} style={styles.artifactRow}>
          <Text style={typography.body}>{ARTIFACT_KIND_LABELS[artifact.kind]}</Text>
          <Pressable onPress={() => handleDownload(artifact.kind)} hitSlop={8}>
            {downloadingKind === artifact.kind ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.downloadText}>Télécharger</Text>
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
  return (
    <Section title="Historique">
      {history.map((event) => (
        <View key={event.id} style={styles.historyRow}>
          <Text style={typography.bodyBold}>{APPLICATION_STATUS_LABELS[event.toStatus]}</Text>
          <Text style={typography.caption}>
            {new Date(event.createdAt).toLocaleString('fr-FR')}
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function performWithdraw() {
    setIsSubmitting(true);
    try {
      await api.withdrawApplication(accessToken, applicationId);
      await onChanged();
    } catch (err) {
      Alert.alert('Erreur', err instanceof ApiError ? err.message : 'Retrait impossible.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePress() {
    if (Platform.OS === 'web') {
      if (window.confirm('Retirer cette candidature ?')) void performWithdraw();
      return;
    }
    Alert.alert('Retirer cette candidature ?', undefined, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => void performWithdraw() },
    ]);
  }

  return (
    <Pressable style={styles.withdrawButton} onPress={handlePress} disabled={isSubmitting}>
      <Text style={styles.withdrawText}>
        {isSubmitting ? 'Retrait en cours…' : 'Retirer ma candidature'}
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
