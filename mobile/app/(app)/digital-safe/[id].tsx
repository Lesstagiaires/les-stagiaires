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

const ACTION_LABELS: Record<string, string> = {
  VIEWED: 'Consulté',
  DOWNLOADED: 'Téléchargé',
  SHARE_CREATED: 'Partage créé',
  SHARE_REVOKED: 'Partage révoqué',
};

export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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
        setLoadError('Document introuvable.');
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
      setLoadError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, id, logout]);

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
          <ErrorText>{loadError ?? 'Document indisponible.'}</ErrorText>
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
                  'Erreur',
                  err instanceof ApiError ? err.message : 'Suppression impossible.',
                );
              }
            };
            if (Platform.OS === 'web') {
              if (window.confirm('Supprimer ce document ?')) void confirmAndDelete();
            } else {
              Alert.alert('Supprimer ce document ?', undefined, [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Supprimer', style: 'destructive', onPress: () => void confirmAndDelete() },
              ]);
            }
          }}
        >
          <Text style={styles.deleteText}>Supprimer le document</Text>
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
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <FormInput placeholder="Titre" value={title} onChangeText={setTitle} />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title="Renommer"
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
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
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
      setError(err instanceof ApiError ? err.message : 'Téléchargement impossible.');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Section title="Versions">
      <PrimaryButton
        title="Télécharger la dernière version"
        onPress={handleDownload}
        loading={downloadingId === 'latest'}
      />
      {versions.map((version) => (
        <View key={version.id} style={styles.listItem}>
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>
              Version {version.versionNumber} — {version.fileName}
            </Text>
            <Text style={styles.listItemSubtitle}>
              {new Date(version.createdAt).toLocaleDateString('fr-FR')}
            </Text>
          </View>
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title="Ajouter une nouvelle version"
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
      setError(err instanceof ApiError ? err.message : 'Création du partage impossible.');
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
    <Section title="Partage">
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
                {share.targetType === 'LINK' ? 'Lien' : 'Utilisateur'}
              </Text>
              <Text style={styles.listItemSubtitle}>
                {share.expiresAt
                  ? `Expire le ${new Date(share.expiresAt).toLocaleDateString('fr-FR')}`
                  : 'Sans expiration'}
              </Text>
            </View>
            <Pressable onPress={() => handleRevoke(share.id)} hitSlop={8}>
              {revokingId === share.id ? (
                <ActivityIndicator color={colors.error} />
              ) : (
                <Text style={styles.removeText}>Révoquer</Text>
              )}
            </Pressable>
          </View>
        ))}

      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title="Créer un lien de partage (QR Code)"
        onPress={handleCreateLink}
        loading={isCreating}
      />
    </Section>
  );
}

function AccessLogSection({ entries }: { entries: AccessLogEntry[] }) {
  return (
    <Section title="Journal d'accès">
      {entries.length === 0 ? (
        <Text style={styles.hint}>Aucun accès enregistré.</Text>
      ) : (
        entries.map((entry) => (
          <View key={entry.id} style={styles.listItem}>
            <View style={styles.listItemContent}>
              <Text style={styles.listItemTitle}>
                {ACTION_LABELS[entry.action] ?? entry.action}
              </Text>
              <Text style={styles.listItemSubtitle}>
                {entry.actor ? entry.actor.lsId : 'Vous'} ·{' '}
                {new Date(entry.createdAt).toLocaleString('fr-FR')}
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
