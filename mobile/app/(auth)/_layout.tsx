import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="register" />
      <Stack.Screen name="verify-otp" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="reset-password" />
      {/* Ouvert depuis le SMS du parent — publique, sans compte. */}
      <Stack.Screen name="consent/[linkId]" />
    </Stack>
  );
}
