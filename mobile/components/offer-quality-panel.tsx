import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type CheckVerdict, type OfferQualityReport } from '../lib/api';
import {
  useQualityAdviceLabels,
  useQualityCheckLabels,
  useQualityLevelLabels,
} from '../lib/opportunity-labels';
import { colors, radius, spacing, typography } from './theme';
import { Section } from './section';

// ============================================================================
// DIAGNOSTIC DE QUALITÉ D'UNE OFFRE
//
// Arbitrage du promoteur : « les entreprises un diagnostic de qualité de leur
// offre avec des recommandations d'amélioration ».
//
// CE QUE CET ÉCRAN N'AFFICHE PAS, ET NE PEUT PAS AFFICHER : un score, un rang,
// une comparaison avec les autres offres. Le service qui le calcule n'a accès à
// aucune autre offre — la garantie est dans l'architecture, pas dans cet écran.
//
// Un diagnostic qui dirait « votre offre est 7e » deviendrait un plateau de
// jeu : on chercherait le geste qui fait gagner une place, puis celui d'après.
// Le classement par pertinence deviendrait une compétition d'optimisation, ce
// que la plateforme promet précisément de ne pas être.
//
// L'ORDRE DES POINTS EST CELUI DU SERVEUR. Il les rend par impact décroissant :
// les compétences d'abord, parce qu'elles pèsent le plus dans le rapprochement.
// Les retrier ici ferait perdre cette information sans que rien ne le signale.
// ============================================================================

const APPARENCE: Record<
  CheckVerdict,
  { icone: 'checkmark-circle' | 'alert-circle' | 'close-circle'; couleur: string }
> = {
  OK: { icone: 'checkmark-circle', couleur: colors.success },
  A_AMELIORER: { icone: 'alert-circle', couleur: colors.warning },
  MANQUANT: { icone: 'close-circle', couleur: colors.error },
};

export function OfferQualityPanel({
  opportunityId,
  accessToken,
}: {
  opportunityId: string;
  accessToken: string;
}) {
  const { t } = useTranslation();
  const checkLabels = useQualityCheckLabels();
  const adviceLabels = useQualityAdviceLabels();
  const levelLabels = useQualityLevelLabels();

  const [report, setReport] = useState<OfferQualityReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReport(await api.getOpportunityQuality(accessToken, opportunityId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.quality.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, opportunityId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <Section title={t('recruiter.quality.title')}>
        <ActivityIndicator color={colors.primary} />
      </Section>
    );
  }

  // Un diagnostic indisponible ne doit pas ressembler à une offre sans défaut.
  if (error || !report) {
    return (
      <Section title={t('recruiter.quality.title')}>
        <Text style={styles.error}>{error ?? t('recruiter.quality.loadError')}</Text>
      </Section>
    );
  }

  const aCorriger = report.points.filter((point) => point.verdict !== 'OK');

  return (
    <Section title={t('recruiter.quality.title')}>
      <View style={styles.levelRow}>
        <Ionicons
          name={report.level === 'COMPLETE' ? 'checkmark-circle' : 'information-circle'}
          size={20}
          color={report.level === 'COMPLETE' ? colors.success : colors.primary}
        />
        <Text style={styles.level}>{levelLabels[report.level]}</Text>
      </View>

      {/*
        Ce que le diagnostic examine, et ce que la plateforme ne prétend PAS
        savoir. Le dire ici évite qu'on cherche un classement qui n'existe pas.
      */}
      <Text style={styles.intro}>{t('recruiter.quality.intro')}</Text>

      <View style={styles.points}>
        {report.points.map((point) => {
          const { icone, couleur } = APPARENCE[point.verdict];
          return (
            <View key={point.check} style={styles.point}>
              <Ionicons name={icone} size={18} color={couleur} />
              <View style={styles.pointBody}>
                <Text style={styles.pointLabel}>{checkLabels[point.check]}</Text>
                {/*
                  Le conseil n'apparaît que là où il y a quelque chose à faire.
                  Un conseil sous un point déjà bon dilue les autres.
                */}
                {point.recommendation && (
                  <Text style={styles.pointAdvice}>
                    {adviceLabels[point.recommendation]}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {aCorriger.length === 0 && (
        <Text style={styles.complete}>{t('recruiter.quality.nothingToFix')}</Text>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  level: {
    ...typography.bodyBold,
  },
  intro: {
    ...typography.caption,
  },
  points: {
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
  point: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  pointBody: {
    flex: 1,
    gap: 2,
  },
  pointLabel: {
    ...typography.body,
  },
  pointAdvice: {
    ...typography.caption,
  },
  complete: {
    ...typography.caption,
    color: colors.success,
  },
  error: {
    ...typography.caption,
    color: colors.error,
  },
});
