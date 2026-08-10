import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../../components/theme';

function TabIcon(name: keyof typeof Ionicons.glyphMap) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  );
}

export default function AppLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('nav.home'), tabBarIcon: TabIcon('home-outline') }}
      />
      <Tabs.Screen
        name="opportunities"
        options={{ title: t('nav.opportunities'), tabBarIcon: TabIcon('search-outline') }}
      />
      <Tabs.Screen
        name="applications"
        options={{ title: t('nav.applications'), tabBarIcon: TabIcon('document-text-outline') }}
      />
      <Tabs.Screen
        name="recruiter"
        options={{ title: t('nav.recruiter'), tabBarIcon: TabIcon('briefcase-outline') }}
      />
      <Tabs.Screen
        name="digital-safe"
        options={{ title: t('nav.digitalSafe'), tabBarIcon: TabIcon('lock-closed-outline') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t('nav.profile'), tabBarIcon: TabIcon('person-outline') }}
      />
      <Tabs.Screen
        name="security"
        options={{ href: null, headerShown: true, title: t('nav.security') }}
      />
      <Tabs.Screen
        name="moderation"
        options={{ href: null, headerShown: true, title: t('nav.moderation') }}
      />
      <Tabs.Screen name="partnership-requests" options={{ href: null }} />
      <Tabs.Screen name="subscriptions" options={{ href: null }} />
      {/* Hors barre d'onglets (href: null) : le programme est ouvert sur invitation,
          la très grande majorité des comptes n'est pas ambassadeur. L'accès se fait
          depuis le profil, pas depuis une navigation permanente qui afficherait à
          tous une porte fermée. */}
      <Tabs.Screen name="ambassador" options={{ href: null }} />
      <Tabs.Screen
        name="ambassadors-admin"
        options={{ href: null, headerShown: true, title: t('ambassadorsAdmin.title') }}
      />
      <Tabs.Screen
        name="subscriptions-admin"
        options={{ href: null, headerShown: true, title: t('nav.subscriptionsAdmin') }}
      />
      {/* Hors barre d'onglets comme les autres back-offices : le contrôle de
          rôle qui compte est celui du SERVEUR, qui rejette /admin/* sans rôle
          ADMIN. Masquer l'onglet évite d'afficher une porte fermée, mais ce
          n'est pas ce qui protège la route. */}
      <Tabs.Screen
        name="guardian-changes-admin"
        options={{
          href: null,
          headerShown: true,
          title: t('auth.guardianChangesAdmin.title'),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{ href: null, headerShown: true, title: t('nav.notifications') }}
      />
    </Tabs>
  );
}
