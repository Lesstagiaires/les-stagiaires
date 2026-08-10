import { useLocalSearchParams } from 'expo-router';
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
  SecondaryButton,
} from '../../../components/form';
import { spacing, typography } from '../../../components/theme';
import { api, ApiError, type ParentalConsentRequest } from '../../../lib/api';

// ============================================================================
// L'ÉCRAN DU PARENT — ACCEPTER OU REFUSER
//
// Il n'existait pas. Le serveur savait créer la demande, la confirmer et la
// refuser ; l'application n'appelait aucune de ces routes. Un mineur
// s'inscrivait, son parent recevait bien un SMS, et le compte restait restreint
// POUR TOUJOURS parce qu'aucun écran ne permettait de finir la validation.
//
// LE PARENT N'A PAS DE COMPTE. Cet écran est donc public : il n'a qu'un lien et
// un code reçus par SMS. Le lien dit DE QUELLE demande il s'agit, le code
// prouve que c'est bien ce téléphone qui répond — c'est ce qui empêche
// quiconque connaîtrait un identifiant de lien de bloquer le compte d'un mineur.
//
// DEUX DÉCISIONS, PAS UNE. « Prévoir un état où le parent peut refuser (pas
// seulement ignorer). » Un écran qui n'offrirait que « J'accepte » ferait du
// silence la seule façon de dire non — et le silence coûte trente jours à
// l'enfant, sans que personne sache si le parent a vu passer quoi que ce soit.
// ============================================================================
export default function ParentalConsentScreen() {
  const { linkId } = useLocalSearchParams<{ linkId: string }>();
  const { t } = useTranslation();

  const [demande, setDemande] = useState<ParentalConsentRequest | null>(null);
  const [code, setCode] = useState('');
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState<'confirm' | 'decline' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!linkId) return;
    try {
      setDemande(await api.getParentalConsentRequest(linkId));
      setErreur(null);
    } catch (err) {
      setErreur(
        err instanceof ApiError ? err.message : t('auth.parentalConsent.loadError'),
      );
    } finally {
      setChargement(false);
    }
  }, [linkId, t]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function confirmer() {
    if (!linkId) return;
    setErreur(null);
    setEnCours('confirm');
    try {
      await api.confirmParentalConsent(linkId, code.trim());
      setResultat(t('auth.parentalConsent.confirmed'));
      await charger();
    } catch (err) {
      setErreur(
        err instanceof ApiError ? err.message : t('auth.parentalConsent.genericError'),
      );
    } finally {
      setEnCours(null);
    }
  }

  // ==========================================================================
  // LA CONFIRMATION EST RENDUE PAR L'ÉCRAN, PAS PAR LE SYSTÈME
  //
  // DÉFAUT CORRIGÉ LE 2026-08-09, trouvé en recette réelle. Ce garde-fou passait
  // par `Alert.alert` de react-native. Or, sur `react-native-web`, ce module est
  // littéralement vide :
  //
  //     class Alert { static alert() {} }
  //
  // Le rappel `onPress` portant l'appel à `refuser()` n'était donc JAMAIS
  // atteint. Cliquer « Je refuse » ne produisait rien : ni dialogue, ni appel
  // réseau, ni message. Le tuteur, ne voyant aucune réaction, finissait par
  // cliquer sur le seul bouton qui répondait — « Je donne mon accord ».
  //
  // Autrement dit : LE DROIT DE REFUSER N'EXISTAIT PAS sur le web, qui est
  // précisément le seul canal dont dispose un tuteur — il reçoit un lien par
  // SMS et n'a pas l'application. Tout le cycle de refus construit côté serveur
  // était inatteignable par la personne pour qui il avait été conçu.
  //
  // La confirmation vit maintenant dans l'état du composant. Elle se comporte
  // identiquement sur le web et en natif, et ne dépend de l'implémentation de
  // personne.
  //
  // LE GARDE-FOU RESTE ENTIER : un refus bloque le compte de l'enfant
  // immédiatement, sans attendre les trente jours. Un doigt qui glisse ne doit
  // pas suffire — il faut toujours deux gestes délibérés.
  // ==========================================================================
  const [refusAConfirmer, setRefusAConfirmer] = useState(false);

  async function refuser() {
    if (!linkId) return;
    setErreur(null);
    setEnCours('decline');
    try {
      await api.declineParentalConsent(linkId, code.trim());
      setRefusAConfirmer(false);
      setResultat(t('auth.parentalConsent.declined'));
      await charger();
    } catch (err) {
      setErreur(
        err instanceof ApiError ? err.message : t('auth.parentalConsent.genericError'),
      );
    } finally {
      setEnCours(null);
    }
  }

  if (chargement) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centre}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!demande) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centre}>
          <ErrorText>{erreur ?? t('auth.parentalConsent.notFound')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.contenu} keyboardShouldPersistTaps="handled">
        <Text style={styles.titre}>{t('auth.parentalConsent.title')}</Text>

        {/*
          CE QUE LE PARENT APPROUVE, avant de pouvoir approuver. Un parent à qui
          l'on demande d'accepter sans rien montrer n'accepte rien : il clique.
        */}
        <Text style={styles.intro}>
          {t('auth.parentalConsent.intro', {
            name: demande.childFirstName,
            phone: demande.childPhoneMasked ?? '',
          })}
        </Text>
        <Text style={styles.explication}>{t('auth.parentalConsent.whatItAllows')}</Text>

        {resultat && <Text style={styles.resultat}>{resultat}</Text>}

        {/*
          La décision est prise, ou le délai est passé : on en rend compte au
          lieu de proposer des boutons qui n'auraient aucun effet.
        */}
        {!demande.isActionable && !resultat && (
          <Text style={styles.statut}>
            {t(`auth.parentalConsent.status.${demande.status}`)}
          </Text>
        )}

        {demande.isActionable && !resultat && (
          <View style={styles.actions}>
            <Text style={styles.libelleCode}>
              {t('auth.parentalConsent.codeLabel')}
            </Text>
            <FormInput
              placeholder={t('auth.parentalConsent.codePlaceholder')}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoCorrect={false}
            />

            {/*
              DEUX GESTES POUR REFUSER, UN SEUL POUR ACCEPTER, et c'est voulu :
              seul le refus bloque immédiatement le compte de l'enfant.

              Tant que la confirmation est demandée, les DEUX décisions
              disparaissent. Le tuteur ne peut pas accepter par erreur alors
              qu'il venait de dire non — c'est exactement ce qui s'est produit
              en recette, quand le dialogue système restait invisible.
            */}
            {!refusAConfirmer ? (
              <>
                <PrimaryButton
                  title={t('auth.parentalConsent.confirm')}
                  onPress={() => void confirmer()}
                  loading={enCours === 'confirm'}
                  disabled={code.trim().length === 0 || enCours !== null}
                />
                <SecondaryButton
                  title={t('auth.parentalConsent.decline')}
                  onPress={() => setRefusAConfirmer(true)}
                  disabled={code.trim().length === 0 || enCours !== null}
                />

                {/* Le refus n'est pas un bouton comme un autre : on le dit. */}
                <Text style={styles.avertissement}>
                  {t('auth.parentalConsent.declineHint')}
                </Text>
              </>
            ) : (
              <View style={styles.confirmationRefus}>
                <Text style={styles.titreConfirmation}>
                  {t('auth.parentalConsent.declineTitle')}
                </Text>
                <Text style={styles.avertissementFort}>
                  {t('auth.parentalConsent.declineWarning', {
                    name: demande.childFirstName,
                  })}
                </Text>
                <SecondaryButton
                  title={t('auth.parentalConsent.declineConfirm')}
                  onPress={() => void refuser()}
                  loading={enCours === 'decline'}
                  disabled={enCours !== null}
                />
                <SecondaryButton
                  title={t('common.cancel')}
                  onPress={() => setRefusAConfirmer(false)}
                  disabled={enCours !== null}
                />
              </View>
            )}
          </View>
        )}

        <ErrorText>{erreur}</ErrorText>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  contenu: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  titre: { ...typography.h1 },
  intro: { ...typography.body },
  explication: { ...typography.caption, lineHeight: 19 },
  actions: { gap: spacing.sm, marginTop: spacing.md },
  libelleCode: { ...typography.bodyBold },
  avertissement: { ...typography.caption, color: colors.muted },
  confirmationRefus: { gap: spacing.sm },
  titreConfirmation: { ...typography.bodyBold },
  // L'avertissement du refus n'est pas une mention discrète : il annonce le
  // blocage immédiat du compte de l'enfant.
  avertissementFort: { ...typography.body, lineHeight: 21 },
  resultat: { ...typography.bodyBold, color: colors.success },
  statut: { ...typography.body, color: colors.muted },
});
