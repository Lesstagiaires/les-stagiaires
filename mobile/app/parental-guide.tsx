import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../components/form';
import { radius, spacing, typography } from '../components/theme';

// ============================================================================
// LA PAGE À MONTRER À SON PARENT OU TUTEUR
//
// POURQUOI ELLE EXISTE. Le promoteur a écrit, en révisant le modèle du refus :
// « nous devons également permettre au mineur de comprendre le refus, de
// présenter à nouveau les avantages et les garanties de la plateforme à son
// représentant légal ». Sans support, « présenter à nouveau » se réduit à
// insister — c'est-à-dire au seul comportement que le délai cherche à décourager.
//
// ELLE S'ADRESSE À L'ADULTE, PAS AU JEUNE. Un parent qui refuse a presque
// toujours de bonnes raisons de le faire : il ne sait pas ce qu'est cette
// application, qui la tient, ce qu'elle fait des papiers de son enfant, ni ce
// qu'un accord l'engage à accepter. Cette page répond à ces questions-là, dans
// cet ordre, et le jeune la lui tend.
//
// CE QU'ELLE NE FAIT PAS : convaincre. Aucun bouton de consentement ici, aucun
// « acceptez maintenant ». Consentir se fait par le SMS, sur le téléphone du
// tuteur, et nulle part ailleurs — sinon le jeune obtiendrait l'accord en
// tendant SON écran, ce qui viderait tout le dispositif.
//
// ELLE EST PUBLIQUE ET SANS DONNÉES. Elle ne lit aucun profil, n'appelle aucune
// API, et ne contient ni nom, ni numéro, ni situation familiale. C'est ce qui
// permet de la montrer, de la lire par-dessus l'épaule, ou de la laisser
// ouverte sur une table sans rien exposer.
// ============================================================================

// Les six garanties, dans l'ordre où un adulte se les pose. Elles reprennent
// exactement ce que le code applique — pas une promesse commerciale de plus.
const GARANTIES = [
  { cle: 'blocked', icone: 'lock-closed-outline' },
  { cle: 'visibility', icone: 'eye-off-outline' },
  { cle: 'documents', icone: 'shield-checkmark-outline' },
  { cle: 'revoke', icone: 'close-circle-outline' },
  { cle: 'noSale', icone: 'pricetags-outline' },
  { cle: 'report', icone: 'alert-circle-outline' },
] as const;

export default function ParentalGuideScreen() {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.ecran}>
      <ScrollView contentContainerStyle={styles.contenu}>
        <Text style={styles.titre}>{t('auth.parentalGuide.title')}</Text>
        <Text style={styles.chapeau}>{t('auth.parentalGuide.intro')}</Text>

        <View style={styles.bloc}>
          <Text style={styles.sousTitre}>
            {t('auth.parentalGuide.whatIsIt.title')}
          </Text>
          <Text style={styles.paragraphe}>
            {t('auth.parentalGuide.whatIsIt.body')}
          </Text>
        </View>

        <View style={styles.bloc}>
          <Text style={styles.sousTitre}>
            {t('auth.parentalGuide.guarantees.title')}
          </Text>
          {GARANTIES.map(({ cle, icone }) => (
            <View key={cle} style={styles.garantie}>
              <Ionicons name={icone} size={20} color={colors.primary} />
              <Text style={styles.garantieTexte}>
                {t(`auth.parentalGuide.guarantees.${cle}`)}
              </Text>
            </View>
          ))}
        </View>

        {/*
          CE QU'UN ACCORD OUVRE, dit sans emballage. Un parent à qui on ne
          présente que des garanties comprend qu'on lui cache la contrepartie —
          et il a raison. La liste est donc explicite : voilà exactement ce que
          votre enfant pourra faire, et rien de plus.
        */}
        <View style={styles.bloc}>
          <Text style={styles.sousTitre}>
            {t('auth.parentalGuide.whatConsentOpens.title')}
          </Text>
          <Text style={styles.paragraphe}>
            {t('auth.parentalGuide.whatConsentOpens.body')}
          </Text>
        </View>

        {/*
          LE DROIT DE REFUSER, ÉCRIT NOIR SUR BLANC. C'est l'endroit où une page
          de ce genre bascule d'ordinaire dans la pression. On dit donc
          l'inverse : refuser est une réponse valable, elle est enregistrée, et
          elle ne se retourne pas contre le jeune.
        */}
        <View style={styles.encadreRefus}>
          <Text style={styles.sousTitre}>
            {t('auth.parentalGuide.rightToRefuse.title')}
          </Text>
          <Text style={styles.paragraphe}>
            {t('auth.parentalGuide.rightToRefuse.body')}
          </Text>
        </View>

        <View style={styles.bloc}>
          <Text style={styles.sousTitre}>
            {t('auth.parentalGuide.howToAnswer.title')}
          </Text>
          <Text style={styles.paragraphe}>
            {t('auth.parentalGuide.howToAnswer.body')}
          </Text>
          {/*
            Le rappel qui empêche l'écran de servir de raccourci : la décision se
            prend sur le téléphone du tuteur, jamais sur celui-ci.
          */}
          <Text style={styles.avertissement}>
            {t('auth.parentalGuide.howToAnswer.notHere')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, backgroundColor: colors.background },
  contenu: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  titre: { ...typography.h1 },
  chapeau: { ...typography.body, lineHeight: 22 },
  bloc: { gap: spacing.sm },
  sousTitre: { ...typography.bodyBold },
  paragraphe: { ...typography.caption, lineHeight: 20 },
  garantie: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  garantieTexte: { ...typography.caption, flex: 1, lineHeight: 20 },
  encadreRefus: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
  avertissement: { ...typography.caption, color: colors.muted, lineHeight: 20 },
});
