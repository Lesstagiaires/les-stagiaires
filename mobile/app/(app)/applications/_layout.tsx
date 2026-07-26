import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../components/theme';

export default function ApplicationsLayout() {
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: t('applications.detailTitle') }} />
    </Stack>
  );
}
