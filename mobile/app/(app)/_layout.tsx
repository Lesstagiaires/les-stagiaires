import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { colors } from '../../components/theme';

function TabIcon(name: keyof typeof Ionicons.glyphMap) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  );
}

export default function AppLayout() {
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
        options={{ title: 'Accueil', tabBarIcon: TabIcon('home-outline') }}
      />
      <Tabs.Screen
        name="opportunities"
        options={{ title: 'Offres', tabBarIcon: TabIcon('search-outline') }}
      />
      <Tabs.Screen
        name="applications"
        options={{ title: 'Candidatures', tabBarIcon: TabIcon('document-text-outline') }}
      />
      <Tabs.Screen
        name="recruiter"
        options={{ title: 'Recruteur', tabBarIcon: TabIcon('briefcase-outline') }}
      />
      <Tabs.Screen
        name="digital-safe"
        options={{ title: 'Coffre-fort', tabBarIcon: TabIcon('lock-closed-outline') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profil', tabBarIcon: TabIcon('person-outline') }}
      />
      <Tabs.Screen
        name="security"
        options={{ href: null, headerShown: true, title: 'Sécurité' }}
      />
    </Tabs>
  );
}
