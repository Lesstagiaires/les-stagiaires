import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* V6-2 — `index` est désormais l'ACCUEIL PUBLIC, et non plus l'écran de
          connexion. C'est lui que rencontre un visiteur sans compte : il montre
          la valeur du service avant de demander quoi que ce soit. La connexion,
          elle, a sa propre route et reste à un geste. */}
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="verify-otp" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="reset-password" />
      {/* Ouvert depuis le SMS du parent — publique, sans compte. */}
      <Stack.Screen name="consent/[linkId]" />
    </Stack>
  );
}
