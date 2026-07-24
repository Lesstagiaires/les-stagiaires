import { Stack } from 'expo-router';
import { colors } from '../../../components/form';

export default function DigitalSafeLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Coffre-fort numérique' }} />
      <Stack.Screen name="[id]" options={{ title: 'Document' }} />
    </Stack>
  );
}
