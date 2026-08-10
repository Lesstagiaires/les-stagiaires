import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Card } from '../../components/card';
import { EmptyState } from '../../components/empty-state';
import {
  colors,
  ErrorText,
  FormInput,
  PrimaryButton,
  SecondaryButton,
} from '../../components/form';
import { spacing, typography } from '../../components/theme';
import { api, ApiError, type PendingGuardianChange } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

// ============================================================================
// LA FILE DES DEMANDES DE CHANGEMENT DE TUTEUR
//
// C'est ici que se joue tout l'équilibre du cycle de refus. Une règle
// automatique ne sait pas distinguer un décès d'un adolescent qui a trouvé un
// adulte plus complaisant ; une personne, avec les bons éléments sous les yeux,
// le peut souvent.
//
// LES BONS ÉLÉMENTS, ce sont ceux que cet écran met côte à côte :
//   — la justification écrite par le jeune ;
//   — le NOMBRE DE REFUS qui précède la demande. Un premier refus suivi d'un
//     déménagement n'a rien à voir avec un troisième refus suivi d'un
//     changement de numéro.
//
// CE QUI N'EST PAS AFFICHÉ : le nom du jeune. Le compte est désigné par son
// LS-ID. Une décision se prend sur une situation, et un identifiant suffit à
// retrouver le dossier — afficher l'identité invite à décider sur autre chose.
//
// LE MOTIF DE DÉCISION EST OBLIGATOIRE DANS LES DEUX SENS. Le serveur et une
// contrainte en base le refusent sinon. Un « non » sans raison n'est opposable
// à personne, et un « oui » sans raison rend le contrôle impossible six mois
// plus tard.
// ============================================================================

export default function GuardianChangesAdminScreen() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();

  const [demandes, setDemandes] = useState<PendingGuardianChange[] | null>(null);
  const [motifs, setMotifs] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    if (!accessToken) return;
    try {
      setDemandes(await api.adminListGuardianChanges(accessToken));
      setErreur(null);
    } catch (err) {
      setErreur(
        err instanceof ApiError
          ? err.message
          : t('auth.guardianChangesAdmin.loadError'),
      );
    }
  }, [accessToken, t]);

  useFocusEffect(
    useCallback(() => {
      void recharger();
    }, [recharger]),
  );

  async function trancher(id: string, approuver: boolean) {
    if (!accessToken) return;
    setErreur(null);
    setEnCours(id);
    try {
      await api.adminDecideGuardianChange(
        accessToken,
        id,
        approuver,
        (motifs[id] ?? '').trim(),
      );
      setMotifs((m) => ({ ...m, [id]: '' }));
      await recharger();
    } catch (err) {
      setErreur(
        err instanceof ApiError
          ? err.message
          : t('auth.guardianChangesAdmin.decideError'),
      );
    } finally {
      setEnCours(null);
    }
  }

  return (
    <SafeAreaView style={styles.ecran}>
      <ScrollView contentContainerStyle={styles.contenu}>
        <Text style={styles.titre}>{t('auth.guardianChangesAdmin.title')}</Text>

        {demandes === null && <ActivityIndicator color={colors.primary} />}

        {demandes?.length === 0 && (
          <EmptyState message={t('auth.guardianChangesAdmin.emptyBody')} />
        )}

        {demandes?.map((d) => {
          // Le serveur exige 10 caractères ; l'écran l'annonce plutôt que de
          // laisser découvrir la règle par une erreur après coup.
          const motif = motifs[d.id] ?? '';
          const peutTrancher = motif.trim().length >= 10 && enCours !== d.id;

          return (
            <Card key={d.id} style={styles.carte}>
              <Text style={styles.compte}>{d.child.lsId}</Text>

              {/* LE COMPTEUR EN PREMIER, avant même la justification : c'est le
                  contexte qui change la lecture de tout le reste. */}
              <Text style={styles.compteur}>
                {t('auth.guardianChangesAdmin.refusalCount', {
                  count: d.refusalCountAtRequest,
                })}
              </Text>

              <Text style={styles.champ}>
                {t('auth.guardianChangesAdmin.requestedPhone', {
                  phone: d.requestedParentPhone,
                })}
              </Text>

              <Text style={styles.justification}>{d.reason}</Text>

              <FormInput
                value={motif}
                onChangeText={(v) => setMotifs((m) => ({ ...m, [d.id]: v }))}
                multiline
                numberOfLines={3}
                style={styles.zoneTexte}
                placeholder={t(
                  'auth.guardianChangesAdmin.decisionReasonPlaceholder',
                )}
              />
              <Text style={styles.aide}>
                {t('auth.guardianChangesAdmin.decisionReasonHelp')}
              </Text>

              <View style={styles.actions}>
                <PrimaryButton
                  title={t('auth.guardianChangesAdmin.approve')}
                  onPress={() => void trancher(d.id, true)}
                  loading={enCours === d.id}
                  disabled={!peutTrancher}
                />
                <SecondaryButton
                  title={t('auth.guardianChangesAdmin.reject')}
                  onPress={() => void trancher(d.id, false)}
                  disabled={!peutTrancher}
                />
              </View>
            </Card>
          );
        })}

        <ErrorText>{erreur}</ErrorText>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, backgroundColor: colors.background },
  contenu: { padding: spacing.lg, gap: spacing.lg },
  titre: { ...typography.h1 },
  carte: { gap: spacing.sm },
  compte: { ...typography.bodyBold },
  compteur: { ...typography.caption, color: colors.warning },
  champ: { ...typography.caption },
  justification: { ...typography.caption, lineHeight: 20 },
  zoneTexte: { minHeight: 80, textAlignVertical: 'top' },
  aide: { ...typography.caption, color: colors.muted },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
});
