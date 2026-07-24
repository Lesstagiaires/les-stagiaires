import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge } from '../../../components/badge';
import { Card } from '../../../components/card';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../components/form';
import { colors, spacing, typography } from '../../../components/theme';
import { api, ApiError, type InternshipReportWithApplication } from '../../../lib/api';
import { REPORT_STATUS_LABELS, REPORT_STATUS_TONE } from '../../../lib/establishment-labels';
import { useAuth } from '../../../lib/auth-context';
import { saveFile } from '../../../lib/save-file';

export default function ReportsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, logout } = useAuth();
  const [reports, setReports] = useState<InternshipReportWithApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      setReports(await api.listEstablishmentReports(accessToken, id));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    }
  }, [id, accessToken, logout]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!accessToken || !id) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>Organisation indisponible.</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Rapports de stage</Text>

        {reports === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : reports.length === 0 ? (
          <Text style={styles.emptyText}>Aucun rapport pour l'instant.</Text>
        ) : (
          <View style={styles.list}>
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                accessToken={accessToken}
                establishmentId={id}
                report={report}
                onChanged={reload}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportRow({
  accessToken,
  establishmentId,
  report,
  onChanged,
}: {
  accessToken: string;
  establishmentId: string;
  report: InternshipReportWithApplication;
  onChanged: () => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [busyAction, setBusyAction] = useState<'download' | 'validate' | 'revise' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    setBusyAction('download');
    try {
      const { blob, fileName } = await api.downloadDocument(accessToken, report.digitalSafeDocumentId);
      await saveFile(blob, fileName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Téléchargement impossible.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReview(status: 'VALIDATED' | 'NEEDS_REVISION') {
    setError(null);
    setBusyAction(status === 'VALIDATED' ? 'validate' : 'revise');
    try {
      await api.reviewReport(accessToken, establishmentId, report.applicationId, {
        status,
        note: note || undefined,
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action impossible.');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <Card style={styles.reportCard}>
      <View style={styles.reportHeader}>
        <Text style={typography.bodyBold}>{report.application.candidate.lsId ?? report.application.candidateId}</Text>
        <Badge label={REPORT_STATUS_LABELS[report.status]} tone={REPORT_STATUS_TONE[report.status]} />
      </View>
      <Text style={typography.caption}>{report.application.reference}</Text>
      {!!report.reviewNote && <Text style={typography.caption}>Note : {report.reviewNote}</Text>}

      <SecondaryButton
        title="Télécharger le rapport"
        onPress={handleDownload}
        loading={busyAction === 'download'}
        disabled={busyAction !== null}
      />

      {report.status === 'SUBMITTED' && (
        <>
          <FormInput
            placeholder="Note (optionnelle)"
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={2}
          />
          <View style={styles.reviewActions}>
            <View style={styles.reviewButton}>
              <PrimaryButton
                title="Valider"
                onPress={() => handleReview('VALIDATED')}
                loading={busyAction === 'validate'}
                disabled={busyAction !== null}
              />
            </View>
            <View style={styles.reviewButton}>
              <SecondaryButton
                title="Demander une correction"
                onPress={() => handleReview('NEEDS_REVISION')}
                loading={busyAction === 'revise'}
                disabled={busyAction !== null}
              />
            </View>
          </View>
        </>
      )}

      <ErrorText>{error}</ErrorText>
    </Card>
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
    gap: spacing.md,
  },
  title: {
    ...typography.h1,
  },
  loader: {
    marginTop: spacing.xxl,
  },
  emptyText: {
    ...typography.caption,
  },
  list: {
    gap: spacing.sm,
  },
  reportCard: {
    gap: spacing.sm,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  reviewActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  reviewButton: {
    flex: 1,
  },
});
