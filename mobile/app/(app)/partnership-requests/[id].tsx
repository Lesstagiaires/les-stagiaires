import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { Card } from '../../../components/card';
import { ChipSelect } from '../../../components/chip-select';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../components/form';
import { Section } from '../../../components/section';
import { colors, spacing, typography } from '../../../components/theme';
import {
  api,
  ApiError,
  type PartnershipRequestContact,
  type PartnershipRequestDetail,
  type PartnershipRequestNote,
  type PartnershipRequestStatus,
} from '../../../lib/api';
import {
  PARTNERSHIP_STATUS_TONE,
  usePartnershipOrgTypeLabels,
  usePartnershipReasonLabels,
  usePartnershipStatusLabels,
} from '../../../lib/partnership-request-labels';
import { useAuth } from '../../../lib/auth-context';

export default function PartnershipRequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const partnershipStatusLabels = usePartnershipStatusLabels();
  const partnershipReasonLabels = usePartnershipReasonLabels();
  const partnershipOrgTypeLabels = usePartnershipOrgTypeLabels();

  const [request, setRequest] = useState<PartnershipRequestDetail | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<PartnershipRequestContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      const [detail, users] = await Promise.all([
        api.getPartnershipRequest(accessToken, id),
        api.listAssignablePartnershipUsers(accessToken),
      ]);
      setRequest(detail);
      setAssignableUsers(users);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      if (err instanceof ApiError && err.statusCode === 403) {
        setLoadError(t('partnershipRequests.unavailable'));
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('partnershipRequests.loadError'));
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

  if (loadError || !request || !accessToken || !id) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{loadError ?? t('partnershipRequests.detail.notFound')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{request.organizationName}</Text>
          <Badge label={partnershipStatusLabels[request.status]} tone={PARTNERSHIP_STATUS_TONE[request.status]} />
        </View>
        <Text style={typography.caption}>{partnershipOrgTypeLabels[request.organizationType]}</Text>

        <Section title={t('partnershipRequests.detail.contactSection')}>
          <Text style={typography.body}>
            {request.contactName}
            {!!request.contactTitle && ` — ${request.contactTitle}`}
          </Text>
          <Text style={typography.caption}>{request.phone}</Text>
          <Text style={typography.caption}>{request.email}</Text>
          <Text style={typography.caption}>
            {request.city ? `${request.city}, ${request.country}` : request.country}
          </Text>
        </Section>

        <Section title={t('partnershipRequests.detail.requestSection')}>
          <Text style={typography.caption}>{partnershipReasonLabels[request.reason]}</Text>
          <Text style={typography.bodyBold}>{request.subject}</Text>
          <Text style={typography.body}>{request.description}</Text>
        </Section>

        <StatusSection accessToken={accessToken} request={request} onChanged={reload} />

        <AssignSection
          accessToken={accessToken}
          request={request}
          assignableUsers={assignableUsers}
          onChanged={reload}
        />

        <NotesSection accessToken={accessToken} requestId={id} notes={request.notes} onChanged={reload} />
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Statut ---------------------------------------------------------------------------------

function StatusSection({
  accessToken,
  request,
  onChanged,
}: {
  accessToken: string;
  request: PartnershipRequestDetail;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const partnershipStatusLabels = usePartnershipStatusLabels();
  const [busyStatus, setBusyStatus] = useState<PartnershipRequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const otherStatuses = (Object.keys(partnershipStatusLabels) as PartnershipRequestStatus[]).filter(
    (status) => status !== request.status,
  );

  async function handleChange(status: PartnershipRequestStatus) {
    setError(null);
    setBusyStatus(status);
    try {
      await api.updatePartnershipRequestStatus(accessToken, request.id, status);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('partnershipRequests.detail.statusError'));
    } finally {
      setBusyStatus(null);
    }
  }

  return (
    <Section title={t('partnershipRequests.detail.statusSection')}>
      <View style={styles.actionsRow}>
        {otherStatuses.map((status) => (
          <View key={status} style={styles.actionButton}>
            <SecondaryButton
              title={partnershipStatusLabels[status]}
              onPress={() => handleChange(status)}
              loading={busyStatus === status}
              disabled={busyStatus !== null && busyStatus !== status}
            />
          </View>
        ))}
      </View>
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

// --- Attribution ------------------------------------------------------------------------------

function AssignSection({
  accessToken,
  request,
  assignableUsers,
  onChanged,
}: {
  accessToken: string;
  request: PartnershipRequestDetail;
  assignableUsers: PartnershipRequestContact[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = [
    { value: '__none__', label: t('partnershipRequests.detail.unassigned') },
    ...assignableUsers.map((user) => ({
      value: user.id,
      label: user.lsId ?? (`${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.id),
    })),
  ];

  async function handleChange(value: string) {
    setError(null);
    setIsSaving(true);
    try {
      await api.assignPartnershipRequest(accessToken, request.id, value === '__none__' ? null : value);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('partnershipRequests.detail.assignError'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section title={t('partnershipRequests.detail.assignSection')}>
      <ChipSelect
        options={options}
        value={request.assignedToId ?? '__none__'}
        onChange={handleChange}
      />
      {isSaving && <ActivityIndicator color={colors.primary} />}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

// --- Historique des échanges ------------------------------------------------------------------

function NotesSection({
  accessToken,
  requestId,
  notes,
  onChanged,
}: {
  accessToken: string;
  requestId: string;
  notes: PartnershipRequestNote[];
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const partnershipStatusLabels = usePartnershipStatusLabels();
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddNote() {
    if (!content.trim()) return;
    setError(null);
    setIsSaving(true);
    try {
      await api.addPartnershipRequestNote(accessToken, requestId, content.trim());
      setContent('');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('partnershipRequests.detail.noteError'));
    } finally {
      setIsSaving(false);
    }
  }

  function describeNote(note: PartnershipRequestNote): string {
    if (note.type === 'NOTE') return note.content ?? '';
    if (note.type === 'STATUS_CHANGE') {
      const previousStatus = note.metadata?.previousStatus as PartnershipRequestStatus | undefined;
      const newStatus = note.metadata?.newStatus as PartnershipRequestStatus | undefined;
      return t('partnershipRequests.detail.statusChangeNote', {
        previous: previousStatus ? partnershipStatusLabels[previousStatus] : '—',
        next: newStatus ? partnershipStatusLabels[newStatus] : '—',
      });
    }
    // ASSIGNMENT
    const assigneeLsId = note.metadata?.assigneeLsId as string | null | undefined;
    return assigneeLsId
      ? t('partnershipRequests.detail.assignmentNote', { name: assigneeLsId })
      : t('partnershipRequests.detail.unassignmentNote');
  }

  return (
    <Section title={t('partnershipRequests.detail.notesSection')}>
      {notes.map((note) => (
        <View key={note.id} style={styles.noteRow}>
          <Text style={typography.body}>{describeNote(note)}</Text>
          <Text style={typography.caption}>
            {(note.author.lsId ?? note.author.id) +
              ' — ' +
              new Date(note.createdAt).toLocaleString(i18n.language)}
          </Text>
        </View>
      ))}
      <FormInput
        placeholder={t('partnershipRequests.detail.notePlaceholder')}
        value={content}
        onChangeText={setContent}
        multiline
        numberOfLines={2}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('partnershipRequests.detail.addNote')}
        onPress={handleAddNote}
        loading={isSaving}
        disabled={!content.trim()}
      />
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
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.h1,
    flexShrink: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionButton: {
    minWidth: 120,
  },
  noteRow: {
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
});
