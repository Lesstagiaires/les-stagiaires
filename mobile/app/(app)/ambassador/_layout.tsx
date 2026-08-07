import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../components/theme';

export default function AmbassadorLayout() {
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('ambassador.title') }} />
      <Stack.Screen
        name="portfolio"
        options={{ title: t('ambassador.portfolio.title') }}
      />
      <Stack.Screen
        name="commissions"
        options={{ title: t('ambassador.commissions.title') }}
      />
      <Stack.Screen
        name="payouts"
        options={{ title: t('ambassador.payouts.title') }}
      />
    </Stack>
  );
}
