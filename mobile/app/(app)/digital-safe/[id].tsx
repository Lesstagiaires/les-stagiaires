import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, ErrorText, FormInput, PrimaryButton } from '../../../components/form';
import { Section } from '../../../components/section';
import {
  api,
  ApiError,
  type AccessLogEntry,
  type DigitalSafeDocument,
  type DigitalSafeShare,
  type DocumentVersion,
  type FilePart,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { saveFile } from '../../../lib/save-file';

export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();

  const [document, setDocument] = useState<DigitalSafeDocument | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [shares, setShares] = useState<DigitalSafeShare[]>([]);
  const [accessLog, setAccessLog] = useState<AccessLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken || !id) return;
    try {
      const [documents, versionList, shareList, logEntries] = await Promise.all([
        api.listDocuments(accessToken),
        api.listDocumentVersions(accessToken, id),
        api.listShares(accessToken, id),
        api.getAccessLog(accessToken, id),
      ]);
      const found = documents.find((doc) => doc.id === id) ?? null;
      if (!found) {
        setLoadError(t('digitalSafe.detail.notFound'));
      } else {
        setDocument(found);
        setLoadError(null);
      }
      setVersions(versionList);
      setShares(shareList);
      setAccessLog(logEntries);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('digitalSafe.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, id, logout, t]);

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

  if (loadError || !document || !accessToken) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{loadError ?? t('digitalSafe.detail.unavailable')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <RenameForm
          accessToken={accessToken}
          document={document}
          onRenamed={reload}
        />

        <VersionsSection
          accessToken={accessToken}
          documentId={document.id}
          versions={versions}
          onChanged={reload}
        />

        <SharesSection
          accessToken={accessToken}
          documentId={document.id}
          shares={shares}
          onChanged={reload}
        />

        <AccessLogSection entries={accessLog} />

        <Pressable
          style={styles.deleteButton}
          onPress={() => {
            const confirmAndDelete = async () => {
              try {
                await api.removeDocument(accessToken, document.id);
                router.back();
              } catch (err) {
                Alert.alert(
                  t('digitalSafe.detail.delete.errorTitle'),
                  err instanceof ApiError ? err.message : t('digitalSafe.detail.delete.error'),
                );
              }
            };
            if (Platform.OS === 'web') {
              if (window.confirm(t('digitalSafe.detail.delete.confirmTitle'))) void confirmAndDelete();
            } else {
              Alert.alert(t('digitalSafe.detail.delete.confirmTitle'), undefined, [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('digitalSafe.detail.delete.button'),
                  style: 'destructive',
                  onPress: () => void confirmAndDelete(),
                },
              ]);
            }
          }}
        >
          <Text style={styles.deleteText}>{t('digitalSafe.detail.delete.button')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function RenameForm({
  accessToken,
  document,
  onRenamed,
}: {
  accessToken: string;
  document: DigitalSafeDocument;
  onRenamed: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(document.title);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      await api.renameDocument(accessToken, document.id, title);
      await onRenamed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('digitalSafe.detail.rename.saveError'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <FormInput
        placeholder={t('digitalSafe.detail.rename.titlePlaceholder')}
        value={title}
        onChangeText={setTitle}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('digitalSafe.detail.rename.button')}
        onPress={handleSave}
        loading={isSaving}
        disabled={!title || title === document.title}
      />
    </View>
  );
}

function VersionsSection({
  accessToken,
  documentId,
  versions,
  onChanged,
}: {
  accessToken: string;
  documentId: string;
  versions: DocumentVersion[];
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [isUploadingVersion, setIsUploadingVersion] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAddVersion() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const part: FilePart = asset.file
      ? asset.file
      : { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream' };

    setError(null);
    setIsUploadingVersion(true);
    try {
      await api.addDocumentVersion(accessToken, documentId, part);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('digitalSafe.detail.versions.uploadError'));
    } finally {
      setIsUploadingVersion(false);
    }
  }

  async function handleDownload() {
    setError(null);
    setDownloadingId('latest');
    try {
      const { blob, fileName } = await api.downloadDocument(accessToken, documentId);
      await saveFile(blob, fileName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('digitalSafe.detail.versions.downloadError'));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Section title={t('digitalSafe.detail.versions.sectionTitle')}>
      <PrimaryButton
        title={t('digitalSafe.detail.versions.downloadLatest')}
        onPress={handleDownload}
        loading={downloadingId === 'latest'}
      />
      {versions.map((version) => (
        <View key={version.id} style={styles.listItem}>
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>
              {t('digitalSafe.detail.versions.versionLabel', {
                number: version.versionNumber,
                fileName: version.fileName,
              })}
            </Text>
            <Text style={styles.listItemSubtitle}>
              {new Date(version.createdAt).toLocaleDateString(i18n.language)}
            </Text>
          </View>
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('digitalSafe.detail.versions.addNew')}
        onPress={handleAddVersion}
        loading={isUploadingVersion}
      />
    </Section>
  );
}

function SharesSection({
  accessToken,
  documentId,
  shares,
  onChanged,
}: {
  accessToken: string;
  documentId: string;
  shares: DigitalSafeShare[];
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newShare, setNewShare] = useState<DigitalSafeShare | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleCreateLink() {
    setError(null);
    setIsCreating(true);
    try {
      const share = await api.createShare(accessToken, documentId, { targetType: 'LINK' });
      setNewShare(share);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('digitalSafe.detail.shares.createError'));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(shareId: string) {
    setRevokingId(shareId);
    try {
      await api.revokeShare(accessToken, documentId, shareId);
      if (newShare?.id === shareId) setNewShare(null);
      await onChanged();
    } catch {
      // Erreur silencieuse : le partage reste affiché, l'utilisateur peut réessayer.
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Section title={t('digitalSafe.detail.shares.sectionTitle')}>
      {newShare?.qrCodeDataUrl && (
        <View style={styles.qrWrapper}>
          <Image source={{ uri: newShare.qrCodeDataUrl }} style={styles.qrImage} />
          <Text style={styles.hint} selectable>
            {newShare.shareUrl}
          </Text>
        </View>
      )}

      {shares
        .filter((share) => !share.revokedAt)
        .map((share) => (
          <View key={share.id} style={styles.listItem}>
            <View style={styles.listItemContent}>
              <Text style={styles.listItemTitle}>
                {share.targetType === 'LINK'
                  ? t('digitalSafe.detail.shares.link')
                  : t('digitalSafe.detail.shares.user')}
              </Text>
              <Text style={styles.listItemSubtitle}>
                {share.expiresAt
                  ? t('digitalSafe.detail.shares.expiresOn', {
                      date: new Date(share.expiresAt).toLocaleDateString(i18n.language),
                    })
                  : t('digitalSafe.detail.shares.noExpiry')}
              </Text>
            </View>
            <Pressable onPress={() => handleRevoke(share.id)} hitSlop={8}>
              {revokingId === share.id ? (
                <ActivityIndicator color={colors.error} />
              ) : (
                <Text style={styles.removeText}>{t('digitalSafe.detail.shares.revoke')}</Text>
              )}
            </Pressable>
          </View>
        ))}

      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('digitalSafe.detail.shares.createLink')}
        onPress={handleCreateLink}
        loading={isCreating}
      />
    </Section>
  );
}

function AccessLogSection({ entries }: { entries: AccessLogEntry[] }) {
  const { t, i18n } = useTranslation();
  const actionLabels: Record<string, string> = {
    VIEWED: t('digitalSafe.detail.accessLog.actions.VIEWED'),
    DOWNLOADED: t('digitalSafe.detail.accessLog.actions.DOWNLOADED'),
    SHARE_CREATED: t('digitalSafe.detail.accessLog.actions.SHARE_CREATED'),
    SHARE_REVOKED: t('digitalSafe.detail.accessLog.actions.SHARE_REVOKED'),
  };
  return (
    <Section title={t('digitalSafe.detail.accessLog.sectionTitle')}>
      {entries.length === 0 ? (
        <Text style={styles.hint}>{t('digitalSafe.detail.accessLog.empty')}</Text>
      ) : (
        entries.map((entry) => (
          <View key={entry.id} style={styles.listItem}>
            <View style={styles.listItemContent}>
              <Text style={styles.listItemTitle}>
                {actionLabels[entry.action] ?? entry.action}
              </Text>
              <Text style={styles.listItemSubtitle}>
                {entry.actor ? entry.actor.lsId : t('digitalSafe.detail.accessLog.you')} ·{' '}
                {new Date(entry.createdAt).toLocaleString(i18n.language)}
              </Text>
            </View>
          </View>
        ))
      )}
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
    paddingHorizontal: 24,
    paddingVertical: 24,
    paddingBottom: 48,
    gap: 8,
  },
  form: {
    gap: 12,
  },
  hint: {
    fontSize: 13,
    color: colors.muted,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listItemContent: {
    flex: 1,
    gap: 2,
  },
  listItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  listItemSubtitle: {
    fontSize: 13,
    color: colors.muted,
  },
  removeText: {
    fontSize: 13,
    color: colors.error,
  },
  qrWrapper: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  qrImage: {
    width: 180,
    height: 180,
  },
  deleteButton: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 12,
  },
  deleteText: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '600',
  },
});
