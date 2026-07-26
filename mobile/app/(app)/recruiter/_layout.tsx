import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../components/theme';

export default function RecruiterLayout() {
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="organization" options={{ title: t('recruiter.layout.organization') }} />
      <Stack.Screen name="team" options={{ title: t('recruiter.layout.team') }} />
      <Stack.Screen name="needs" options={{ title: t('recruiter.layout.needs') }} />
      <Stack.Screen name="learners" options={{ title: t('recruiter.layout.learners') }} />
      <Stack.Screen name="campaigns" options={{ title: t('recruiter.layout.campaigns') }} />
      <Stack.Screen
        name="learner-applications"
        options={{ title: t('recruiter.layout.learnerApplications') }}
      />
      <Stack.Screen name="reports" options={{ title: t('recruiter.layout.reports') }} />
      <Stack.Screen name="dashboard" options={{ title: t('recruiter.layout.dashboard') }} />
      <Stack.Screen name="partners" options={{ title: t('recruiter.layout.partners') }} />
      <Stack.Screen
        name="opportunities/index"
        options={{ title: t('recruiter.layout.myOpportunities') }}
      />
      <Stack.Screen
        name="opportunities/new"
        options={{ title: t('recruiter.layout.newOpportunity') }}
      />
      <Stack.Screen
        name="opportunities/[id]"
        options={{ title: t('recruiter.layout.manageOpportunity') }}
      />
      <Stack.Screen
        name="applications/index"
        options={{ title: t('recruiter.layout.receivedApplications') }}
      />
      <Stack.Screen
        name="applications/[id]"
        options={{ title: t('recruiter.layout.applicationDetail') }}
      />
    </Stack>
  );
}
