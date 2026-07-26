import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../components/form';

export default function DigitalSafeLayout() {
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('digitalSafe.layoutTitle') }} />
      <Stack.Screen name="[id]" options={{ title: t('digitalSafe.documentTitle') }} />
    </Stack>
  );
}
