import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../components/theme';

export default function PartnershipRequestsLayout() {
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('partnershipRequests.title') }} />
      <Stack.Screen name="[id]" options={{ title: t('partnershipRequests.detail.title') }} />
    </Stack>
  );
}
