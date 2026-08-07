import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Badge } from '../../../components/badge';
import { PressableCard } from '../../../components/card';
import { EmptyState } from '../../../components/empty-state';
import { colors, ErrorText } from '../../../components/form';
import { fonts, radius, spacing, typography } from '../../../components/theme';
import {
  AMBASSADOR_STATUS_TONE,
  useAmbassadorStatusLabels,
} from '../../../lib/ambassador-labels';
import { api, ApiError, type MyAmbassador } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { formatAmountMinor } from '../../../lib/money';

export default function AmbassadorHomeScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const statusLabels = useAmbassadorStatusLabels();

  const [ambassador, setAmbassador] = useState<MyAmbassador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notAmbassador, setNotAmbassador] = useState(false);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      setAmbassador(await api.getMyAmbassador(accessToken));
      setNotAmbassador(false);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      // 404 : le compte n'est simplement pas ambassadeur. Ce n'est pas une erreur,
      // c'est le cas de la très grande majorité des comptes — on l'affiche comme une
      // invitation, jamais comme une panne.
      if (err instanceof ApiError && err.statusCode === 404) {
        setNotAmbassador(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : t('ambassador.loadError'));
    }
  }, [accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function shareCode() {
    if (!ambassador) return;
    await Share.share({
      message: t('ambassador.shareMessage', { code: ambassador.code }),
    });
  }

  if (!accessToken) return null;

  if (notAmbassador) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState message={t('ambassador.notAmbassador')} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <ErrorText>{error}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  if (!ambassador) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      </SafeAreaView>
    );
  }

  const wallet = ambassador.wallet;
  const currency = wallet?.currency ?? 'XAF';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Le code d'affiliation est l'outil de travail de l'ambassadeur : il se dicte
            au téléphone et se recopie depuis une affiche. D'où le traitement en tableau
            d'affichage — fond sombre, chiffres monospacés, très espacés — qui rend
            chaque caractère lisible sans hésitation. */}
        <View style={styles.codePanel}>
          <Text style={styles.codeEyebrow}>{t('ambassador.codeLabel')}</Text>
          <Text style={styles.codeValue} selectable>
            {ambassador.code}
          </Text>
          <Pressable
            onPress={() => void shareCode()}
            style={styles.shareButton}
            hitSlop={8}
          >
            <Ionicons name="share-outline" size={16} color={colors.inkDeep} />
            <Text style={styles.shareText}>{t('ambassador.share')}</Text>
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <Badge
            label={statusLabels[ambassador.status]}
            tone={AMBASSADOR_STATUS_TONE[ambassador.status]}
          />
        </View>

        {/* Le verrou contractuel, dit franchement. Un ambassadeur qui accumule des
            commissions sans pouvoir les retirer doit savoir pourquoi dès son écran
            d'accueil — le découvrir au moment de demander un versement serait une
            mauvaise surprise, et une mauvaise surprise sur de l'argent. */}
        {!ambassador.contractSignedAt && (
          <View style={styles.notice}>
            <Ionicons
              name="document-text-outline"
              size={18}
              color={colors.accentDark}
            />
            <Text style={styles.noticeText}>
              {t('ambassador.contractPending')}
            </Text>
          </View>
        )}

        {ambassador.status === 'SUSPENDED' && (
          <View style={styles.noticeError}>
            <Ionicons name="pause-circle-outline" size={18} color={colors.error} />
            <Text style={styles.noticeErrorText}>
              {ambassador.suspensionReason ?? t('ambassador.suspended')}
            </Text>
          </View>
        )}

        <View style={styles.balanceGrid}>
          <BalanceTile
            label={t('ambassador.balance.available')}
            value={formatAmountMinor(
              wallet?.availableMinor ?? 0,
              currency,
              i18n.language,
            )}
            highlighted
          />
          <BalanceTile
            label={t('ambassador.balance.pending')}
            value={formatAmountMinor(
              wallet?.pendingMinor ?? 0,
              currency,
              i18n.language,
            )}
          />
          <BalanceTile
            label={t('ambassador.balance.reserved')}
            value={formatAmountMinor(
              wallet?.reservedMinor ?? 0,
              currency,
              i18n.language,
            )}
          />
          <BalanceTile
            label={t('ambassador.balance.paid')}
            value={formatAmountMinor(
              wallet?.paidTotalMinor ?? 0,
              currency,
              i18n.language,
            )}
          />
        </View>

        <Text style={styles.balanceHint}>{t('ambassador.balance.hint')}</Text>

        <View style={styles.list}>
          <PressableCard
            style={styles.linkCard}
            onPress={() => router.push('/ambassador/portfolio')}
          >
            <View style={styles.linkRow}>
              <Text style={typography.h3}>
                {t('ambassador.portfolio.title')}
              </Text>
              <Text style={styles.counter}>{ambassador.portfolioCount}</Text>
            </View>
            <Text style={typography.caption}>
              {t('ambassador.portfolio.subtitle')}
            </Text>
          </PressableCard>

          <PressableCard
            style={styles.linkCard}
            onPress={() => router.push('/ambassador/commissions')}
          >
            <View style={styles.linkRow}>
              <Text style={typography.h3}>
                {t('ambassador.commissions.title')}
              </Text>
              <Text style={styles.counter}>{ambassador.referralCount}</Text>
            </View>
            <Text style={typography.caption}>
              {t('ambassador.referralsSubtitle')}
            </Text>
          </PressableCard>

          <PressableCard
            style={styles.linkCard}
            onPress={() => router.push('/ambassador/payouts')}
          >
            <Text style={typography.h3}>{t('ambassador.payouts.title')}</Text>
            <Text style={typography.caption}>
              {t('ambassador.payouts.subtitle')}
            </Text>
          </PressableCard>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BalanceTile({
  label,
  value,
  highlighted,
}: {
  label: string;
  value: string;
  highlighted?: boolean;
}) {
  return (
    <View style={[styles.tile, highlighted && styles.tileHighlighted]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, highlighted && styles.tileValueHighlighted]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  loader: {
    marginTop: spacing.xxl,
  },
  codePanel: {
    backgroundColor: colors.inkDeep,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  codeEyebrow: {
    ...typography.label,
    color: colors.graphiteMute,
  },
  codeValue: {
    fontFamily: fonts.mono,
    fontSize: 40,
    color: colors.gold,
    // L'espacement large est ce qui rend le code dictable au téléphone sans confusion.
    letterSpacing: 6,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  shareText: {
    ...typography.bodyBold,
    color: colors.inkDeep,
  },
  statusRow: {
    flexDirection: 'row',
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.accentLight,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  noticeText: {
    ...typography.caption,
    color: colors.accentDark,
    flex: 1,
  },
  noticeError: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.errorLight,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  noticeErrorText: {
    ...typography.caption,
    color: colors.error,
    flex: 1,
  },
  balanceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  tileHighlighted: {
    backgroundColor: colors.primaryLight,
  },
  tileLabel: {
    ...typography.label,
  },
  tileValue: {
    fontFamily: fonts.mono,
    fontSize: 18,
    color: colors.text,
  },
  tileValueHighlighted: {
    color: colors.primaryDark,
  },
  balanceHint: {
    ...typography.caption,
    color: colors.muted,
  },
  list: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  linkCard: {
    gap: spacing.xs,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {
    fontFamily: fonts.mono,
    fontSize: 20,
    color: colors.accentDark,
  },
});
