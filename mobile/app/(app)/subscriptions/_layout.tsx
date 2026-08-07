import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../components/theme';

export default function SubscriptionsLayout() {
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('subscriptions.title') }} />
      <Stack.Screen name="new" options={{ title: t('subscriptions.new.title') }} />
      <Stack.Screen name="[id]" options={{ title: t('subscriptions.detail.title') }} />
    </Stack>
  );
}
