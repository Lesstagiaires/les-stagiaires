import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge } from '../../../components/badge';
import { Card } from '../../../components/card';
import { ChipSelect } from '../../../components/chip-select';
import { ErrorText, FormInput, PrimaryButton } from '../../../components/form';
import { Section } from '../../../components/section';
import { colors, spacing, typography } from '../../../components/theme';
import { api, ApiError, type NeedRequestType, type OrganizationNeedRequest } from '../../../lib/api';
import {
  NEED_REQUEST_STATUS_LABELS,
  NEED_REQUEST_STATUS_TONE,
  NEED_REQUEST_TYPE_LABELS,
  NEED_REQUEST_TYPE_OPTIONS,
} from '../../../lib/organization-labels';
import { useAuth } from '../../../lib/auth-context';

export default function NeedRequestsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, logout } = useAuth();
  const [requests, setRequests] = useState<OrganizationNeedRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      setRequests(await api.listNeedRequests(accessToken, id));
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
        <Text style={styles.title}>Besoins spéciaux</Text>
        <Text style={typography.caption}>
          Les offres saisonnières, bénévoles ou temporaires nécessitent l'approbation de
          l'équipe LES STAGIAIRES avant publication.
        </Text>

        {requests === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <View style={styles.list}>
            {requests.length === 0 ? (
              <Text style={styles.emptyText}>Aucune demande pour l'instant.</Text>
            ) : (
              requests.map((request) => (
                <Card key={request.id} style={styles.requestCard}>
                  <View style={styles.requestHeader}>
                    <Text style={typography.bodyBold}>
                      {NEED_REQUEST_TYPE_LABELS[request.type]} — {request.quantity}
                    </Text>
                    <Badge
                      label={NEED_REQUEST_STATUS_LABELS[request.status]}
                      tone={NEED_REQUEST_STATUS_TONE[request.status]}
                    />
                  </View>
                  <Text style={typography.body}>{request.description}</Text>
                  {!!request.adminNote && (
                    <Text style={typography.caption}>Réponse : {request.adminNote}</Text>
                  )}
                </Card>
              ))
            )}
          </View>
        )}

        <CreateNeedRequestSection accessToken={accessToken} organizationId={id} onCreated={reload} />

        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </SafeAreaView>
  );
}

function CreateNeedRequestSection({
  accessToken,
  organizationId,
  onCreated,
}: {
  accessToken: string;
  organizationId: string;
  onCreated: () => Promise<void>;
}) {
  const [type, setType] = useState<NeedRequestType | null>(null);
  const [quantity, setQuantity] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedQuantity = Number(quantity);
  const canSubmit = !!type && Number.isInteger(parsedQuantity) && parsedQuantity > 0 && !!description.trim();

  async function handleSubmit() {
    if (!type) return;
    setError(null);
    setIsSaving(true);
    try {
      await api.submitNeedRequest(accessToken, organizationId, {
        type,
        quantity: parsedQuantity,
        description,
      });
      setType(null);
      setQuantity('');
      setDescription('');
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section title="Nouvelle demande">
      <ChipSelect options={NEED_REQUEST_TYPE_OPTIONS} value={type} onChange={(v) => setType(v as NeedRequestType)} />
      <FormInput
        placeholder="Quantité"
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="number-pad"
      />
      <FormInput
        placeholder="Décrivez votre besoin"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
        style={styles.multiline}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title="Envoyer la demande" onPress={handleSubmit} loading={isSaving} disabled={!canSubmit} />
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
  requestCard: {
    gap: spacing.xs,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
