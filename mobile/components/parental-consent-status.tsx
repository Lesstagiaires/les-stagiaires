import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  api,
  ApiError,
  type ParentalLink,
  type ParentalLinkStatus,
} from '../lib/api';
import { colors, ErrorText, SecondaryButton } from './form';
import { radius, spacing, typography } from './theme';
import { Section } from './section';

// ============================================================================
// LE PARCOURS CÔTÉ MINEUR
//
// Le parent pouvait décider ; l'enfant, lui, ne voyait rien. Ni où en était sa
// demande, ni quand le code expire, ni comment relancer si le SMS s'est perdu.
// Un compte pouvait donc rester bloqué sans que son titulaire — un mineur —
// comprenne pourquoi. C'est le pire des silences : celui qu'on n'a aucun moyen
// de lever.
//
// QUATRE SITUATIONS À DIRE CLAIREMENT, et elles ne se ressemblent pas :
//
//   — EN ATTENTE : le SMS est parti, le parent n'a pas encore répondu.
//   — CODE EXPIRÉ : le délai est passé. Il faut relancer, et c'est possible.
//   — REFUSÉ : le parent a dit non. Le compte est bloqué, et une relance n'y
//     changerait rien — le dire évite de laisser espérer.
//   — VALIDÉ : tout est ouvert.
//
// CE QUE CET ÉCRAN NE MONTRE JAMAIS : le code. Le mineur ne doit pas le
// connaître, sinon il consent à la place de son parent — ce que tout le
// dispositif cherche à empêcher. Le serveur ne le transmet pas ; cet écran n'a
// donc rien à masquer, ce qui est la bonne façon de garantir une absence.
// ============================================================================

const APPARENCE: Record<
  ParentalLinkStatus,
  { icone: 'time-outline' | 'checkmark-circle' | 'close-circle' | 'alert-circle'; couleur: string }
> = {
  PENDING: { icone: 'time-outline', couleur: colors.muted },
  ACTIVE: { icone: 'checkmark-circle', couleur: colors.success },
  DECLINED: { icone: 'close-circle', couleur: colors.error },
  EXPIRED: { icone: 'alert-circle', couleur: colors.warning },
  REVOKED: { icone: 'alert-circle', couleur: colors.muted },
};

export function ParentalConsentStatus({
  accessToken,
}: {
  accessToken: string;
}) {
  const { t } = useTranslation();

  const [liens, setLiens] = useState<ParentalLink[] | null>(null);
  const [relanceEnCours, setRelanceEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      setLiens(await api.listMyParentalLinks(accessToken));
      setErreur(null);
    } catch (err) {
      setErreur(
        err instanceof ApiError ? err.message : t('auth.parentalStatus.loadError'),
      );
    }
  }, [accessToken, t]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function relancer(parentPhone: string) {
    setErreur(null);
    setMessage(null);
    setRelanceEnCours(true);
    try {
      await api.requestParentalConsent(accessToken, parentPhone);
      setMessage(t('auth.parentalStatus.resent'));
      await charger();
    } catch (err) {
      // Le délai de garde du serveur remonte ici avec son propre message, qui
      // dit combien de temps attendre. On le préfère à un texte générique.
      setErreur(
        err instanceof ApiError ? err.message : t('auth.parentalStatus.resendError'),
      );
    } finally {
      setRelanceEnCours(false);
    }
  }

  // Rien à afficher : ce compte n'a jamais eu besoin d'un accord parental. On ne
  // montre pas une rubrique vide qui inquiéterait pour rien.
  if (liens !== null && liens.length === 0) return null;

  if (liens === null) {
    return (
      <Section title={t('auth.parentalStatus.title')}>
        <ActivityIndicator color={colors.primary} />
      </Section>
    );
  }

  // Le plus récent d'abord — le serveur trie déjà, mais l'écran ne montre que
  // celui-là : afficher l'historique des tuteurs révoqués n'aide personne et
  // exposerait des numéros que le mineur a changés pour une raison.
  const courant = liens[0];
  const { icone, couleur } = APPARENCE[courant.status];
  const peutRelancer =
    courant.status === 'PENDING' || courant.status === 'EXPIRED';
  const relanceOuverteA = courant.resendAvailableAt
    ? new Date(courant.resendAvailableAt)
    : null;
  const relanceBloquee = !!relanceOuverteA && relanceOuverteA > new Date();

  return (
    <Section title={t('auth.parentalStatus.title')}>
      <View style={styles.ligne}>
        <Ionicons name={icone} size={20} color={couleur} />
        <Text style={styles.etat}>
          {/*
            Un code expiré n'est PAS la même chose qu'une attente : le premier
            demande une action, le second demande de la patience. Les confondre
            laisserait le mineur attendre indéfiniment.
          */}
          {courant.status === 'PENDING' && courant.codeExpired
            ? t('auth.parentalStatus.status.CODE_EXPIRED')
            : t(`auth.parentalStatus.status.${courant.status}`)}
        </Text>
      </View>

      <Text style={styles.detail}>
        {t('auth.parentalStatus.sentTo', { phone: courant.parentPhone })}
      </Text>

      {courant.status === 'PENDING' && !courant.codeExpired && (
        <Text style={styles.detail}>
          {t('auth.parentalStatus.whatIsBlocked')}
        </Text>
      )}

      {/*
        Le refus est définitif depuis l'application. Le dire évite au mineur de
        relancer en boucle un parent qui a déjà tranché.
      */}
      {courant.status === 'DECLINED' && (
        <Text style={styles.detail}>{t('auth.parentalStatus.declinedHelp')}</Text>
      )}

      {message && <Text style={styles.succes}>{message}</Text>}

      {peutRelancer && (
        <View style={styles.actions}>
          <Text style={styles.aide}>{t('auth.parentalStatus.notReceived')}</Text>
          <SecondaryButton
            title={
              relanceBloquee
                ? t('auth.parentalStatus.resendWait')
                : t('auth.parentalStatus.resend')
            }
            onPress={() => void relancer(courant.parentPhone)}
            loading={relanceEnCours}
            disabled={relanceEnCours || relanceBloquee}
          />
        </View>
      )}

      <ErrorText>{erreur}</ErrorText>
    </Section>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  etat: { ...typography.bodyBold, flex: 1 },
  detail: { ...typography.caption, lineHeight: 19 },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
  aide: { ...typography.caption },
  succes: { ...typography.bodyBold, color: colors.success },
});
