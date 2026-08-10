import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  colors,
  ErrorText,
  FormInput,
  PrimaryButton,
} from '../components/form';
import { radius, spacing, typography } from '../components/theme';
import {
  api,
  ApiError,
  type GuardianChangeRequest,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

// ============================================================================
// DEMANDER UN CHANGEMENT DE REPRÉSENTANT LÉGAL
//
// LA SEULE PORTE DE SORTIE DU CYCLE DE REFUS, et elle passe par un humain.
//
// Cet écran a un problème de conception que le code ne peut pas résoudre seul :
// il est à la fois la réponse à une vraie détresse — un décès, un placement, un
// parent parti — et le contournement évident du délai de refus. Les deux
// arrivent par la même porte, avec les mêmes mots.
//
// Ce qu'on peut faire, c'est ne pas mentir sur la nature de la démarche :
//   — dire d'emblée qu'une personne lira, ce qui décourage la demande de
//     dépit sans décourager la demande sincère ;
//   — exiger une justification substantielle (30 caractères minimum côté
//     serveur), parce qu'une décision se prend sur quelque chose ;
//   — ne rien promettre sur le délai ni sur l'issue.
//
// CE QU'IL NE FAUT SURTOUT PAS FAIRE : présenter la procédure comme un recours
// contre le refus. Ce n'est pas un appel — le tuteur qui a refusé n'est pas
// jugé, il reste le tuteur. C'est un constat de changement de situation.
// ============================================================================

export default function GuardianChangeScreen() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();

  const [demandes, setDemandes] = useState<GuardianChangeRequest[] | null>(null);
  const [phone, setPhone] = useState('');
  const [motif, setMotif] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!accessToken) return;
    try {
      setDemandes(await api.listMyGuardianChanges(accessToken));
      setErreur(null);
    } catch (err) {
      setErreur(
        err instanceof ApiError
          ? err.message
          : t('auth.guardianChange.loadError'),
      );
    }
  }, [accessToken, t]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function envoyer() {
    if (!accessToken) return;
    setErreur(null);
    setEnvoiEnCours(true);
    try {
      await api.requestGuardianChange(accessToken, phone.trim(), motif.trim());
      setPhone('');
      setMotif('');
      await charger();
    } catch (err) {
      // Le serveur renvoie ici des refus PARLANTS — même numéro que le tuteur
      // actuel, demande déjà en cours, compte devenu majeur. Les remplacer par
      // un texte générique effacerait la seule information utile.
      setErreur(
        err instanceof ApiError
          ? err.message
          : t('auth.guardianChange.submitError'),
      );
    } finally {
      setEnvoiEnCours(false);
    }
  }

  // Le serveur impose 30 caractères ; l'écran l'annonce plutôt que de laisser
  // découvrir la règle par un message d'erreur après un envoi.
  const peutEnvoyer =
    !!phone.trim() && motif.trim().length >= 30 && !envoiEnCours;

  const enCours = demandes?.find((d) => d.status === 'SUBMITTED');
  const derniereTranchee = demandes?.find((d) => d.status !== 'SUBMITTED');

  return (
    <SafeAreaView style={styles.ecran}>
      <ScrollView contentContainerStyle={styles.contenu}>
        <Text style={styles.chapeau}>{t('auth.guardianChange.intro')}</Text>

        {demandes === null && <ActivityIndicator color={colors.primary} />}

        {/* Une demande en cours ferme le formulaire : le serveur refuserait de
            toute façon (index unique partiel), et proposer un champ qui sera
            rejeté est une promesse qu'on ne tient pas. */}
        {enCours ? (
          <View style={styles.encadre}>
            <Text style={styles.sousTitre}>
              {t('auth.guardianChange.pendingTitle')}
            </Text>
            <Text style={styles.detail}>
              {t('auth.guardianChange.pendingBody', {
                phone: enCours.requestedParentPhone,
              })}
            </Text>
          </View>
        ) : (
          demandes !== null && (
            <View style={styles.bloc}>
              <View style={styles.champ}>
                <Text style={typography.label}>
                  {t('auth.guardianChange.phoneLabel')}
                </Text>
                <FormInput
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  placeholder="+237..."
                />
              </View>

              <View style={styles.champ}>
                <Text style={typography.label}>
                  {t('auth.guardianChange.reasonLabel')}
                </Text>
                <FormInput
                  value={motif}
                  onChangeText={setMotif}
                  multiline
                  numberOfLines={5}
                  style={styles.zoneTexte}
                  placeholder={t('auth.guardianChange.reasonPlaceholder')}
                />
              </View>
              <Text style={styles.aide}>
                {t('auth.guardianChange.reasonHelp')}
              </Text>
              <PrimaryButton
                title={t('auth.guardianChange.submit')}
                onPress={() => void envoyer()}
                loading={envoiEnCours}
                disabled={!peutEnvoyer}
              />
            </View>
          )
        )}

        {/* LA DÉCISION EST RENDUE AVEC SON MOTIF. Un refus qu'on ne peut pas
            connaître n'est opposable à personne — encore moins à un mineur qui
            vient d'exposer sa situation familiale. */}
        {derniereTranchee && (
          <View style={styles.encadre}>
            <Text style={styles.sousTitre}>
              {t(`auth.guardianChange.status.${derniereTranchee.status}`)}
            </Text>
            {derniereTranchee.decisionReason && (
              <Text style={styles.detail}>
                {derniereTranchee.decisionReason}
              </Text>
            )}
          </View>
        )}

        <ErrorText>{erreur}</ErrorText>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, backgroundColor: colors.background },
  contenu: { padding: spacing.lg, gap: spacing.lg },
  chapeau: { ...typography.caption, lineHeight: 20 },
  bloc: { gap: spacing.md },
  champ: { gap: spacing.xs },
  // La justification demande plusieurs phrases : un champ d'une ligne
  // suggérerait qu'un mot suffit, et c'est le texte sur lequel un
  // administrateur devra trancher.
  zoneTexte: { minHeight: 120, textAlignVertical: 'top' },
  sousTitre: { ...typography.bodyBold },
  detail: { ...typography.caption, lineHeight: 20 },
  aide: { ...typography.caption, color: colors.muted },
  encadre: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
});
