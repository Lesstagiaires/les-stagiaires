import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { ChipSelect } from '../../../components/chip-select';
import { EmptyState } from '../../../components/empty-state';
import { colors, ErrorText, FormInput, PrimaryButton } from '../../../components/form';
import {
  api,
  ApiError,
  type DigitalSafeDocument,
  type DigitalSafeDocumentCategory,
  type FilePart,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';

function useCategoryLabels(): Record<DigitalSafeDocumentCategory, string> {
  const { t } = useTranslation();
  return {
    IDENTITY: t('digitalSafe.categories.IDENTITY'),
    DIPLOMA: t('digitalSafe.categories.DIPLOMA'),
    CERTIFICATE: t('digitalSafe.categories.CERTIFICATE'),
    INTERNSHIP_REPORT: t('digitalSafe.categories.INTERNSHIP_REPORT'),
    CONVENTION: t('digitalSafe.categories.CONVENTION'),
    ADMISSION_LETTER: t('digitalSafe.categories.ADMISSION_LETTER'),
    OTHER: t('digitalSafe.categories.OTHER'),
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function DigitalSafeListScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const categoryLabels = useCategoryLabels();
  const { accessToken, logout } = useAuth();
  const [documents, setDocuments] = useState<DigitalSafeDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const list = await api.listDocuments(accessToken);
      setDocuments(list);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('digitalSafe.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <UploadForm accessToken={accessToken} onUploaded={reload} />

        {isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : loadError ? (
          <ErrorText>{loadError}</ErrorText>
        ) : documents.length === 0 ? (
          <EmptyState message={t('digitalSafe.empty')} />
        ) : (
          documents.map((document) => (
            <Pressable
              key={document.id}
              style={styles.card}
              onPress={() => router.push(`/digital-safe/${document.id}`)}
            >
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{document.title}</Text>
                <Text style={styles.cardSubtitle}>{categoryLabels[document.category]}</Text>
                {document.latestVersion && (
                  <Text style={styles.cardMeta}>
                    {document.latestVersion.fileName} ·{' '}
                    {formatSize(document.latestVersion.sizeBytes)}
                  </Text>
                )}
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function UploadForm({
  accessToken,
  onUploaded,
}: {
  accessToken: string | null;
  onUploaded: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const categoryLabels = useCategoryLabels();
  const categoryOptions = Object.entries(categoryLabels).map(([value, label]) => ({
    value: value as DigitalSafeDocumentCategory,
    label,
  }));
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<DigitalSafeDocumentCategory>('OTHER');
  const [title, setTitle] = useState('');
  const [pickedFile, setPickedFile] = useState<{ part: FilePart; name: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const part: FilePart = asset.file
      ? asset.file
      : { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream' };
    setPickedFile({ part, name: asset.name });
  }

  async function handleUpload() {
    if (!accessToken || !pickedFile) return;
    setError(null);
    setIsUploading(true);
    try {
      await api.createDocument(accessToken, category, title, pickedFile.part);
      setTitle('');
      setPickedFile(null);
      setIsOpen(false);
      await onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('digitalSafe.uploadError'));
    } finally {
      setIsUploading(false);
    }
  }

  if (!isOpen) {
    return (
      <Pressable onPress={() => setIsOpen(true)}>
        <Text style={styles.addText}>{t('digitalSafe.addLink')}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.form}>
      <Text style={styles.formLabel}>{t('digitalSafe.categoryLabel')}</Text>
      <ChipSelect
        options={categoryOptions}
        value={category}
        onChange={(value) => setCategory(value as DigitalSafeDocumentCategory)}
      />
      <FormInput
        placeholder={t('digitalSafe.titlePlaceholder')}
        value={title}
        onChangeText={setTitle}
      />
      <PrimaryButton
        title={
          pickedFile
            ? t('digitalSafe.fileSelected', { name: pickedFile.name })
            : t('digitalSafe.chooseFile')
        }
        onPress={handlePickFile}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('digitalSafe.send')}
        onPress={handleUpload}
        loading={isUploading}
        disabled={!title || !pickedFile}
      />
      <Pressable
        onPress={() => {
          setIsOpen(false);
          setPickedFile(null);
          setError(null);
        }}
      >
        <Text style={styles.cancelText}>{t('common.cancel')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    paddingBottom: 48,
    gap: 12,
  },
  form: {
    gap: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 8,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  addText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '600',
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cardContent: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  cardSubtitle: {
    fontSize: 13,
    color: colors.muted,
  },
  cardMeta: {
    fontSize: 12,
    color: colors.muted,
  },
  chevron: {
    fontSize: 22,
    color: colors.muted,
  },
});
