import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../../components/badge';
import { Card } from '../../../../components/card';
import { DateInput } from '../../../../components/date-input';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../../components/form';
import { Section } from '../../../../components/section';
import { colors, spacing, typography } from '../../../../components/theme';
import { api, ApiError, type ApplicationArtifactKind, type ApplicationDetail } from '../../../../lib/api';
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONE,
  ARTIFACT_KIND_LABELS,
} from '../../../../lib/application-labels';
import { useAuth } from '../../../../lib/auth-context';
import { saveFile } from '../../../../lib/save-file';

const PROCESSABLE_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'INTERVIEW_PROPOSED',
  'INTERVIEW_CONFIRMED',
];

export default function ReceivedApplicationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, logout } = useAuth();
  const { t } = useTranslation();

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
      setLoadError(err instanceof ApiError ? err.message : t('recruiter.receivedApplications.loadError'));
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
          <ErrorText>{loadError ?? t('recruiter.receivedApplications.detail.unavailable')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  const canMarkUnderReview = application.status === 'SUBMITTED';
  const canProcess = PROCESSABLE_STATUSES.includes(application.status);
  const canRejectOnly = application.status === 'AWAITING_TRAVEL_CONSENT';

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
          {application.opportunity?.title ?? t('applications.list.spontaneous')}
        </Text>
        <Text style={styles.candidate}>
          {t('recruiter.receivedApplications.detail.candidateLabel', {
            lsId: application.candidate?.lsId ?? '—',
          })}
        </Text>

        <DossierSection dossier={application.dossierSnapshot} />

        {canMarkUnderReview && (
          <MarkUnderReviewButton accessToken={accessToken} applicationId={id} onChanged={reload} />
        )}

        {application.documentRequests.length > 0 && (
          <DocumentRequestsSection requests={application.documentRequests} />
        )}

        {canProcess && (
          <RequestDocumentSection accessToken={accessToken} applicationId={id} onChanged={reload} />
        )}

        {canProcess && (
          <InterviewSection
            accessToken={accessToken}
            applicationId={id}
            application={application}
            onChanged={reload}
          />
        )}

        {application.status === 'AWAITING_TRAVEL_CONSENT' && (
          <Section title={t('recruiter.receivedApplications.detail.travelConsent.title')}>
            <Text style={typography.body}>
              {t('recruiter.receivedApplications.detail.travelConsent.body')}
            </Text>
          </Section>
        )}

        {application.status === 'ADMISSION_LETTER_SENT' && (
          <Section title={t('recruiter.receivedApplications.detail.admissionLetterSent.title')}>
            <Text style={typography.body}>
              {t('recruiter.receivedApplications.detail.admissionLetterSent.body')}
            </Text>
          </Section>
        )}

        {(canProcess || canRejectOnly) && (
          <DecisionSection
            accessToken={accessToken}
            applicationId={id}
            canAccept={canProcess}
            onChanged={reload}
          />
        )}

        {application.status === 'ACCEPTED' && (
          <>
            <SignatureSection
              accessToken={accessToken}
              applicationId={id}
              application={application}
              onChanged={reload}
            />
            <CompleteSection accessToken={accessToken} applicationId={id} onChanged={reload} />
          </>
        )}

        {application.status === 'COMPLETED' && (
          <RecommendSection accessToken={accessToken} applicationId={id} />
        )}

        {application.artifacts.length > 0 && (
          <ArtifactsSection
            accessToken={accessToken}
            applicationId={id}
            artifacts={application.artifacts}
          />
        )}

        <HistorySection history={application.history} />
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Dossier du candidat (snapshot au moment de la candidature) ----------------------------

function DossierSection({ dossier }: { dossier: ApplicationDetail['dossierSnapshot'] }) {
  const { t } = useTranslation();
  return (
    <Section title={t('recruiter.receivedApplications.detail.dossier.title')}>
      {!!dossier.headline && <Text style={typography.bodyBold}>{dossier.headline}</Text>}
      {!!dossier.summary && <Text style={typography.body}>{dossier.summary}</Text>}

      {dossier.education.length > 0 && (
        <View style={styles.dossierBlock}>
          <Text style={typography.label}>{t('recruiter.receivedApplications.detail.dossier.education')}</Text>
          {dossier.education.map((entry) => (
            <Text key={entry.id} style={typography.body}>
              {entry.degree ? `${entry.degree} — ` : ''}
              {entry.institution}
            </Text>
          ))}
        </View>
      )}

      {dossier.experience.length > 0 && (
        <View style={styles.dossierBlock}>
          <Text style={typography.label}>{t('recruiter.receivedApplications.detail.dossier.experience')}</Text>
          {dossier.experience.map((entry) => (
            <Text key={entry.id} style={typography.body}>
              {entry.title} — {entry.organization}
            </Text>
          ))}
        </View>
      )}

      {dossier.languages.length > 0 && (
        <View style={styles.dossierBlock}>
          <Text style={typography.label}>{t('recruiter.receivedApplications.detail.dossier.languages')}</Text>
          <Text style={typography.body}>
            {dossier.languages.map((entry) => entry.language).join(', ')}
          </Text>
        </View>
      )}

      {dossier.recommendations.length > 0 && (
        <Text style={typography.caption}>
          {t('recruiter.receivedApplications.detail.dossier.recommendationsCount', {
            count: dossier.recommendations.length,
          })}
        </Text>
      )}

      {!dossier.headline &&
        !dossier.summary &&
        dossier.education.length === 0 &&
        dossier.experience.length === 0 &&
        dossier.languages.length === 0 && (
          <Text style={typography.caption}>{t('recruiter.receivedApplications.detail.dossier.empty')}</Text>
        )}
    </Section>
  );
}

// --- Passage en examen -----------------------------------------------------------------------

function MarkUnderReviewButton({
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

  async function handlePress() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.markApplicationUnderReview(accessToken, applicationId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.receivedApplications.detail.actionError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.inlineAction}>
      <SecondaryButton
        title={t('recruiter.receivedApplications.detail.markUnderReview')}
        onPress={handlePress}
        loading={isSubmitting}
      />
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

// --- Documents complémentaires demandés (historique) ----------------------------------------

function DocumentRequestsSection({ requests }: { requests: ApplicationDetail['documentRequests'] }) {
  const { t } = useTranslation();
  return (
    <Section title={t('recruiter.receivedApplications.detail.documentRequests.title')}>
      {requests.map((request) => (
        <View key={request.id} style={styles.historyRow}>
          <Text style={typography.body}>{request.description}</Text>
          <Text style={typography.caption}>
            {request.status === 'FULFILLED'
              ? t('recruiter.receivedApplications.detail.documentRequests.fulfilled')
              : t('recruiter.receivedApplications.detail.documentRequests.pending')}
          </Text>
        </View>
      ))}
    </Section>
  );
}

function RequestDocumentSection({
  accessToken,
  applicationId,
  onChanged,
}: {
  accessToken: string;
  applicationId: string;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.requestApplicationDocument(accessToken, applicationId, description);
      setDescription('');
      setIsOpen(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.receivedApplications.detail.requestDocument.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <View style={styles.inlineAction}>
        <SecondaryButton
          title={t('recruiter.receivedApplications.detail.requestDocument.openButton')}
          onPress={() => setIsOpen(true)}
        />
      </View>
    );
  }

  return (
    <Section title={t('recruiter.receivedApplications.detail.requestDocument.title')}>
      <FormInput
        placeholder={t('recruiter.receivedApplications.detail.requestDocument.placeholder')}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={2}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('recruiter.receivedApplications.detail.requestDocument.submit')}
        onPress={handleSubmit}
        loading={isSubmitting}
        disabled={!description.trim()}
      />
      <Text style={styles.cancelText} onPress={() => setIsOpen(false)}>
        {t('recruiter.receivedApplications.detail.requestDocument.cancel')}
      </Text>
    </Section>
  );
}

// --- Entretien ---------------------------------------------------------------------------

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
  const [isOpen, setIsOpen] = useState(false);
  const [date, setDate] = useState<Date | null>(
    application.interviewProposedAt ? new Date(application.interviewProposedAt) : null,
  );
  const [time, setTime] = useState('');
  const [mode, setMode] = useState(application.interviewMode ?? '');
  const [location, setLocation] = useState(application.interviewLocation ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyProposed = !!application.interviewProposedAt;

  async function handleSubmit() {
    if (!date) return;
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    const hours = match ? Number(match[1]) : 9;
    const minutes = match ? Number(match[2]) : 0;
    const proposedAt = new Date(date);
    proposedAt.setHours(hours, minutes, 0, 0);

    setError(null);
    setIsSubmitting(true);
    try {
      await api.proposeInterview(accessToken, applicationId, {
        proposedAt: proposedAt.toISOString(),
        mode,
        location: location || undefined,
      });
      setIsOpen(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.receivedApplications.detail.interview.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title={t('recruiter.receivedApplications.detail.interview.title')}>
      {alreadyProposed && (
        <>
          <Text style={typography.body}>
            {new Date(application.interviewProposedAt as string).toLocaleString(i18n.language)}
          </Text>
          {!!application.interviewMode && (
            <Text style={typography.caption}>
              {t('recruiter.receivedApplications.detail.interview.modeLabel', { mode: application.interviewMode })}
            </Text>
          )}
          {!!application.interviewLocation && (
            <Text style={typography.caption}>
              {t('recruiter.receivedApplications.detail.interview.locationLabel', {
                location: application.interviewLocation,
              })}
            </Text>
          )}
          <Text style={typography.caption}>
            {application.interviewConfirmedAt
              ? t('recruiter.receivedApplications.detail.interview.confirmed')
              : t('recruiter.receivedApplications.detail.interview.awaitingConfirmation')}
          </Text>
        </>
      )}

      {isOpen ? (
        <>
          <DateInput
            placeholder={t('recruiter.receivedApplications.detail.interview.datePlaceholder')}
            value={date}
            onChange={setDate}
          />
          <FormInput
            placeholder={t('recruiter.receivedApplications.detail.interview.timePlaceholder')}
            value={time}
            onChangeText={setTime}
          />
          <FormInput
            placeholder={t('recruiter.receivedApplications.detail.interview.modePlaceholder')}
            value={mode}
            onChangeText={setMode}
          />
          <FormInput
            placeholder={t('recruiter.receivedApplications.detail.interview.locationPlaceholder')}
            value={location}
            onChangeText={setLocation}
          />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title={
              alreadyProposed
                ? t('recruiter.receivedApplications.detail.interview.reschedule')
                : t('recruiter.receivedApplications.detail.interview.propose')
            }
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={!date || !mode.trim()}
          />
          <Text style={styles.cancelText} onPress={() => setIsOpen(false)}>
            {t('recruiter.receivedApplications.detail.interview.cancel')}
          </Text>
        </>
      ) : (
        <SecondaryButton
          title={
            alreadyProposed
              ? t('recruiter.receivedApplications.detail.interview.reschedule')
              : t('recruiter.receivedApplications.detail.interview.proposeNew')
          }
          onPress={() => setIsOpen(true)}
        />
      )}
    </Section>
  );
}

// --- Décision -----------------------------------------------------------------------------

function DecisionSection({
  accessToken,
  applicationId,
  canAccept,
  onChanged,
}: {
  accessToken: string;
  applicationId: string;
  canAccept: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [busyDecision, setBusyDecision] = useState<'ACCEPTED' | 'REJECTED' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDecide(decision: 'ACCEPTED' | 'REJECTED') {
    setError(null);
    setBusyDecision(decision);
    try {
      await api.decideApplication(accessToken, applicationId, { decision, note: note || undefined });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.receivedApplications.detail.decision.error'));
    } finally {
      setBusyDecision(null);
    }
  }

  return (
    <Section title={t('recruiter.receivedApplications.detail.decision.title')}>
      <FormInput
        placeholder={t('recruiter.receivedApplications.detail.decision.notePlaceholder')}
        value={note}
        onChangeText={setNote}
        multiline
        numberOfLines={2}
      />
      <ErrorText>{error}</ErrorText>
      <View style={styles.decisionRow}>
        {canAccept && (
          <View style={styles.decisionButton}>
            <PrimaryButton
              title={t('recruiter.receivedApplications.detail.decision.accept')}
              onPress={() => handleDecide('ACCEPTED')}
              loading={busyDecision === 'ACCEPTED'}
              disabled={busyDecision !== null && busyDecision !== 'ACCEPTED'}
            />
          </View>
        )}
        <View style={styles.decisionButton}>
          <SecondaryButton
            title={t('recruiter.receivedApplications.detail.decision.reject')}
            onPress={() => handleDecide('REJECTED')}
            loading={busyDecision === 'REJECTED'}
            disabled={busyDecision !== null && busyDecision !== 'REJECTED'}
          />
        </View>
      </View>
    </Section>
  );
}

// --- Signature de la convention ------------------------------------------------------------

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

  const alreadySigned = !!application.organizationSignedAt;

  async function handleSign() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.signApplication(accessToken, applicationId, name);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.receivedApplications.detail.signature.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title={t('recruiter.receivedApplications.detail.signature.title')}>
      <Text style={typography.caption}>
        {t('recruiter.receivedApplications.detail.signature.candidateLabel')}{' '}
        {application.candidateSignedAt
          ? t('recruiter.receivedApplications.detail.signature.signedBy', {
              name: application.candidateSignedName,
            })
          : t('recruiter.receivedApplications.detail.signature.unsigned')}
      </Text>
      <Text style={typography.caption}>
        {t('recruiter.receivedApplications.detail.signature.yourLabel')}{' '}
        {alreadySigned
          ? t('recruiter.receivedApplications.detail.signature.signedBy', {
              name: application.organizationSignedName,
            })
          : t('recruiter.receivedApplications.detail.signature.unsigned')}
      </Text>
      {!alreadySigned && (
        <>
          <FormInput
            placeholder={t('recruiter.receivedApplications.detail.signature.namePlaceholder')}
            value={name}
            onChangeText={setName}
          />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title={t('recruiter.receivedApplications.detail.signature.submit')}
            onPress={handleSign}
            loading={isSubmitting}
            disabled={!name.trim()}
          />
        </>
      )}
    </Section>
  );
}

// --- Clôture --------------------------------------------------------------------------------

function CompleteSection({
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

  async function handleComplete() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.completeApplication(accessToken, applicationId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.receivedApplications.detail.complete.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title={t('recruiter.receivedApplications.detail.complete.title')}>
      <Text style={typography.body}>{t('recruiter.receivedApplications.detail.complete.body')}</Text>
      <ErrorText>{error}</ErrorText>
      <SecondaryButton
        title={t('recruiter.receivedApplications.detail.complete.submit')}
        onPress={handleComplete}
        loading={isSubmitting}
      />
    </Section>
  );
}

// --- Recommandation -------------------------------------------------------------------------

function RecommendSection({
  accessToken,
  applicationId,
}: {
  accessToken: string;
  applicationId: string;
}) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.recommendCandidate(accessToken, applicationId, message);
      setIsSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.receivedApplications.detail.recommend.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section title={t('recruiter.receivedApplications.detail.recommend.title')}>
      {isSent ? (
        <Text style={typography.body}>{t('recruiter.receivedApplications.detail.recommend.sent')}</Text>
      ) : (
        <>
          <FormInput
            placeholder={t('recruiter.receivedApplications.detail.recommend.placeholder')}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={4}
          />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title={t('recruiter.receivedApplications.detail.recommend.submit')}
            onPress={handleSend}
            loading={isSubmitting}
            disabled={message.trim().length < 10}
          />
        </>
      )}
    </Section>
  );
}

// --- Artefacts --------------------------------------------------------------------------------

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
  const [downloadingKind, setDownloadingKind] = useState<ApplicationArtifactKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(kind: ApplicationArtifactKind) {
    setError(null);
    setDownloadingKind(kind);
    try {
      const { blob, fileName } = await api.downloadArtifact(accessToken, applicationId, kind);
      await saveFile(blob, fileName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.receivedApplications.detail.artifacts.error'));
    } finally {
      setDownloadingKind(null);
    }
  }

  return (
    <Section title={t('recruiter.receivedApplications.detail.artifacts.title')}>
      {artifacts.map((artifact) => (
        <View key={artifact.id} style={styles.artifactRow}>
          <Text style={typography.body}>{ARTIFACT_KIND_LABELS[artifact.kind]}</Text>
          <Pressable onPress={() => handleDownload(artifact.kind)} hitSlop={8}>
            {downloadingKind === artifact.kind ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.downloadText}>{t('recruiter.receivedApplications.detail.artifacts.download')}</Text>
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
  return (
    <Section title={t('recruiter.receivedApplications.detail.history.title')}>
      {history.map((event) => (
        <View key={event.id} style={styles.historyRow}>
          <Text style={typography.bodyBold}>{APPLICATION_STATUS_LABELS[event.toStatus]}</Text>
          <Text style={typography.caption}>
            {new Date(event.createdAt).toLocaleString(i18n.language)}
          </Text>
          {!!event.note && <Text style={typography.caption}>{event.note}</Text>}
        </View>
      ))}
    </Section>
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
  candidate: {
    ...typography.body,
    color: colors.textSecondary,
  },
  dossierBlock: {
    gap: spacing.xs,
  },
  inlineAction: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  cancelText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  decisionRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  decisionButton: {
    flex: 1,
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
});
