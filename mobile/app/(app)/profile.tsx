import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/badge';
import { Card } from '../../components/card';
import { ChipSelect } from '../../components/chip-select';
import { DateInput } from '../../components/date-input';
import { colors, ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../components/form';
import { Section } from '../../components/section';
import {
  api,
  ApiError,
  type Education,
  type EstablishmentEnrollment,
  type Experience,
  type HeldRole,
  type LanguageLevel,
  type Profile,
  type Recommendation,
  type RoleCatalogItem,
} from '../../lib/api';
import { useLearnerStatusLabels, LEARNER_STATUS_TONE } from '../../lib/establishment-labels';
import { SUPPORTED_LANGUAGES, setAppLanguage, type AppLanguage } from '../../lib/i18n';
import { useAuth } from '../../lib/auth-context';
import { formatDisplayDate, toIsoDateString } from '../../lib/date';

export default function ProfileScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [catalog, setCatalog] = useState<RoleCatalogItem[]>([]);
  const [heldRoles, setHeldRoles] = useState<HeldRole[]>([]);
  const [enrollments, setEnrollments] = useState<EstablishmentEnrollment[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [nextProfile, nextCatalog, nextHistory, nextEnrollments] = await Promise.all([
        api.getMyProfile(accessToken),
        api.getRoleCatalog(),
        api.getRoleHistory(accessToken),
        api.listMyEnrollments(accessToken),
      ]);
      setProfile(nextProfile);
      setCatalog(nextCatalog);
      setHeldRoles(nextHistory.filter((entry) => entry.isActive));
      setEnrollments(nextEnrollments);
      setRecommendations(await api.listRecommendations(accessToken, nextProfile.userId));
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('common.connectionError'));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, logout, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !profile || !accessToken) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{loadError ?? t('common.genericError')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.screenTitle}>{t('profile.title')}</Text>

        <ProfileHeaderForm
          accessToken={accessToken}
          profile={profile}
          onSaved={reload}
        />

        <RolesSection
          accessToken={accessToken}
          activeRoleId={profile.activeRoleId}
          heldRoles={heldRoles}
          catalog={catalog}
          onChanged={reload}
        />

        {enrollments.length > 0 && (
          <EstablishmentsSection accessToken={accessToken} enrollments={enrollments} onChanged={reload} />
        )}

        <EducationSection
          accessToken={accessToken}
          educations={profile.educations}
          onChanged={reload}
        />

        <ExperienceSection
          accessToken={accessToken}
          experiences={profile.experiences}
          onChanged={reload}
        />

        <LanguageSection
          accessToken={accessToken}
          languages={profile.languages}
          onChanged={reload}
        />

        {recommendations.length > 0 && (
          <RecommendationsSection
            accessToken={accessToken}
            recommendations={recommendations}
            onChanged={reload}
          />
        )}

        <AppLanguageSection />

        <Pressable onPress={() => router.push('/security')} style={styles.securityLink}>
          <Text style={styles.addText}>{t('profile.securityLink')}</Text>
        </Pressable>

        <Pressable onPress={() => void logout()} style={styles.logout}>
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// --- FR-PRO-001 : champs de base --------------------------------------------------------

function ProfileHeaderForm({
  accessToken,
  profile,
  onSaved,
}: {
  accessToken: string;
  profile: Profile;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState(profile.fullName ?? '');
  const [headline, setHeadline] = useState(profile.headline ?? '');
  const [summary, setSummary] = useState(profile.summary ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFullName(profile.fullName ?? '');
    setHeadline(profile.headline ?? '');
    setSummary(profile.summary ?? '');
  }, [profile]);

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      await api.updateMyProfile(accessToken, { fullName, headline, summary });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('profile.header.saveError'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <FormInput
        placeholder={t('profile.header.fullNamePlaceholder')}
        value={fullName}
        onChangeText={setFullName}
      />
      <FormInput
        placeholder={t('profile.header.headlinePlaceholder')}
        value={headline}
        onChangeText={setHeadline}
      />
      <FormInput
        placeholder={t('profile.header.summaryPlaceholder')}
        value={summary}
        onChangeText={setSummary}
        multiline
        numberOfLines={4}
        style={styles.multiline}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title={t('common.save')} onPress={handleSave} loading={isSaving} />
    </View>
  );
}

// --- FR-PRO-002 : casquette active -------------------------------------------------------

function RolesSection({
  accessToken,
  activeRoleId,
  heldRoles,
  catalog,
  onChanged,
}: {
  accessToken: string;
  activeRoleId: string | null;
  heldRoles: HeldRole[];
  catalog: RoleCatalogItem[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heldRoleIds = new Set(heldRoles.map((entry) => entry.roleId));
  const available = catalog.filter((role) => !heldRoleIds.has(role.id));

  async function handleSwitch(roleId: string) {
    setError(null);
    setIsBusy(true);
    try {
      await api.switchActiveRole(accessToken, roleId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('profile.roles.switchError'));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAdd(roleId: string) {
    setError(null);
    setIsBusy(true);
    try {
      await api.assignRole(accessToken, roleId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.addError'));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Section title={t('profile.roles.title')}>
      {heldRoles.length > 0 ? (
        <>
          <Text style={styles.hint}>{t('profile.roles.activeHint')}</Text>
          <ChipSelect
            options={heldRoles.map((entry) => ({
              value: entry.roleId,
              label: entry.role.name,
            }))}
            value={activeRoleId}
            onChange={handleSwitch}
          />
        </>
      ) : (
        <Text style={styles.hint}>{t('profile.roles.noRoles')}</Text>
      )}

      {available.length > 0 && (
        <>
          <Text style={styles.hint}>{t('profile.roles.addTitle')}</Text>
          <ChipSelect
            options={available.map((role) => ({ value: role.id, label: role.name }))}
            value={null}
            onChange={handleAdd}
          />
        </>
      )}

      {isBusy && <ActivityIndicator color={colors.primary} />}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

// --- EDU-FR-004 : rattachement à un établissement -----------------------------------------

function EstablishmentsSection({
  accessToken,
  enrollments,
  onChanged,
}: {
  accessToken: string;
  enrollments: EstablishmentEnrollment[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const learnerStatusLabels = useLearnerStatusLabels();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(enrollment: EstablishmentEnrollment, accept: boolean) {
    setError(null);
    setBusyId(enrollment.id);
    try {
      if (accept) {
        await api.acceptEnrollment(accessToken, enrollment.id);
      } else {
        await api.declineEnrollment(accessToken, enrollment.id);
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.actionError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Section title={t('profile.establishments.title')}>
      {enrollments.map((enrollment) => (
        <View key={enrollment.id} style={styles.enrollmentItem}>
          <View style={styles.enrollmentHeader}>
            <Text style={styles.listItemTitle}>{enrollment.establishment.name}</Text>
            <Badge
              label={learnerStatusLabels[enrollment.status]}
              tone={LEARNER_STATUS_TONE[enrollment.status]}
            />
          </View>
          {enrollment.status === 'PENDING' && (
            <View style={styles.enrollmentActions}>
              <View style={styles.enrollmentButton}>
                <PrimaryButton
                  title={t('common.accept')}
                  onPress={() => respond(enrollment, true)}
                  loading={busyId === enrollment.id}
                  disabled={busyId !== null && busyId !== enrollment.id}
                />
              </View>
              <View style={styles.enrollmentButton}>
                <SecondaryButton
                  title={t('common.decline')}
                  onPress={() => respond(enrollment, false)}
                  loading={false}
                  disabled={busyId !== null}
                />
              </View>
            </View>
          )}
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

// --- Formation ---------------------------------------------------------------------------

function EducationSection({
  accessToken,
  educations,
  onChanged,
}: {
  accessToken: string;
  educations: Education[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [institution, setInstitution] = useState('');
  const [degree, setDegree] = useState('');
  const [fieldOfStudy, setFieldOfStudy] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function resetForm() {
    setInstitution('');
    setDegree('');
    setFieldOfStudy('');
    setStartDate(null);
    setEndDate(null);
  }

  async function handleAdd() {
    setError(null);
    setIsSaving(true);
    try {
      await api.addEducation(accessToken, {
        institution,
        degree: degree || undefined,
        fieldOfStudy: fieldOfStudy || undefined,
        startDate: startDate ? toIsoDateString(startDate) : undefined,
        endDate: endDate ? toIsoDateString(endDate) : undefined,
      });
      resetForm();
      setIsAdding(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.addError'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      await api.removeEducation(accessToken, id);
      await onChanged();
    } catch {
      // Erreur silencieuse : l'élément reste affiché, l'utilisateur peut réessayer.
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Section title={t('profile.education.title')}>
      {educations.map((education) => (
        <View key={education.id} style={styles.listItem}>
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>{education.institution}</Text>
            {!!education.degree && (
              <Text style={styles.listItemSubtitle}>{education.degree}</Text>
            )}
            {!!(education.startDate || education.endDate) && (
              <Text style={styles.listItemDates}>
                {formatDisplayDate(education.startDate)} —{' '}
                {formatDisplayDate(education.endDate) || t('common.ongoing')}
              </Text>
            )}
          </View>
          <Pressable onPress={() => handleRemove(education.id)} hitSlop={8}>
            {removingId === education.id ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={styles.removeText}>{t('common.remove')}</Text>
            )}
          </Pressable>
        </View>
      ))}

      {isAdding ? (
        <View style={styles.form}>
          <FormInput
            placeholder={t('profile.education.institutionPlaceholder')}
            value={institution}
            onChangeText={setInstitution}
          />
          <FormInput
            placeholder={t('profile.education.degreePlaceholder')}
            value={degree}
            onChangeText={setDegree}
          />
          <FormInput
            placeholder={t('profile.education.fieldOfStudyPlaceholder')}
            value={fieldOfStudy}
            onChangeText={setFieldOfStudy}
          />
          <DateInput
            placeholder={t('profile.education.startDatePlaceholder')}
            value={startDate}
            onChange={setStartDate}
          />
          <DateInput
            placeholder={t('profile.education.endDatePlaceholder')}
            value={endDate}
            onChange={setEndDate}
          />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title={t('common.add')}
            onPress={handleAdd}
            loading={isSaving}
            disabled={!institution}
          />
          <Pressable onPress={() => setIsAdding(false)}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setIsAdding(true)}>
          <Text style={styles.addText}>{t('profile.education.addLink')}</Text>
        </Pressable>
      )}
    </Section>
  );
}

// --- Expérience ----------------------------------------------------------------------------

function ExperienceSection({
  accessToken,
  experiences,
  onChanged,
}: {
  accessToken: string;
  experiences: Experience[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [organization, setOrganization] = useState('');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function resetForm() {
    setOrganization('');
    setTitle('');
    setStartDate(null);
    setEndDate(null);
  }

  async function handleAdd() {
    setError(null);
    setIsSaving(true);
    try {
      await api.addExperience(accessToken, {
        organization,
        title,
        startDate: startDate ? toIsoDateString(startDate) : undefined,
        endDate: endDate ? toIsoDateString(endDate) : undefined,
      });
      resetForm();
      setIsAdding(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.addError'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      await api.removeExperience(accessToken, id);
      await onChanged();
    } catch {
      // Erreur silencieuse : l'élément reste affiché, l'utilisateur peut réessayer.
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Section title={t('profile.experience.title')}>
      {experiences.map((experience) => (
        <View key={experience.id} style={styles.listItem}>
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>{experience.title}</Text>
            <Text style={styles.listItemSubtitle}>{experience.organization}</Text>
            {!!(experience.startDate || experience.endDate) && (
              <Text style={styles.listItemDates}>
                {formatDisplayDate(experience.startDate)} —{' '}
                {formatDisplayDate(experience.endDate) || t('common.ongoing')}
              </Text>
            )}
          </View>
          <Pressable onPress={() => handleRemove(experience.id)} hitSlop={8}>
            {removingId === experience.id ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={styles.removeText}>{t('common.remove')}</Text>
            )}
          </Pressable>
        </View>
      ))}

      {isAdding ? (
        <View style={styles.form}>
          <FormInput
            placeholder={t('profile.experience.titlePlaceholder')}
            value={title}
            onChangeText={setTitle}
          />
          <FormInput
            placeholder={t('profile.experience.organizationPlaceholder')}
            value={organization}
            onChangeText={setOrganization}
          />
          <DateInput
            placeholder={t('profile.education.startDatePlaceholder')}
            value={startDate}
            onChange={setStartDate}
          />
          <DateInput
            placeholder={t('profile.education.endDatePlaceholder')}
            value={endDate}
            onChange={setEndDate}
          />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton
            title={t('common.add')}
            onPress={handleAdd}
            loading={isSaving}
            disabled={!organization || !title}
          />
          <Pressable onPress={() => setIsAdding(false)}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setIsAdding(true)}>
          <Text style={styles.addText}>{t('profile.experience.addLink')}</Text>
        </Pressable>
      )}
    </Section>
  );
}

// --- FR-PRO-006 : langues ------------------------------------------------------------------

function LanguageSection({
  accessToken,
  languages,
  onChanged,
}: {
  accessToken: string;
  languages: Profile['languages'];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [language, setLanguage] = useState('');
  const [level, setLevel] = useState<LanguageLevel>('INTERMEDIAIRE');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingLanguage, setRemovingLanguage] = useState<string | null>(null);

  const levelOptions: { value: LanguageLevel; label: string }[] = [
    { value: 'BASIQUE', label: t('profile.cvLanguages.levels.BASIQUE') },
    { value: 'INTERMEDIAIRE', label: t('profile.cvLanguages.levels.INTERMEDIAIRE') },
    { value: 'AVANCE', label: t('profile.cvLanguages.levels.AVANCE') },
    { value: 'COURANT', label: t('profile.cvLanguages.levels.COURANT') },
    { value: 'NATIF', label: t('profile.cvLanguages.levels.NATIF') },
  ];

  async function handleAdd() {
    setError(null);
    setIsSaving(true);
    try {
      await api.upsertLanguage(accessToken, language, level);
      setLanguage('');
      setLevel('INTERMEDIAIRE');
      setIsAdding(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.addError'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove(entryLanguage: string) {
    setRemovingLanguage(entryLanguage);
    try {
      await api.removeLanguage(accessToken, entryLanguage);
      await onChanged();
    } catch {
      // Erreur silencieuse : l'élément reste affiché, l'utilisateur peut réessayer.
    } finally {
      setRemovingLanguage(null);
    }
  }

  return (
    <Section title={t('profile.cvLanguages.title')}>
      {languages.map((entry) => (
        <View key={entry.id} style={styles.listItem}>
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>{entry.language}</Text>
            <Text style={styles.listItemSubtitle}>
              {levelOptions.find((option) => option.value === entry.level)?.label}
            </Text>
          </View>
          <Pressable onPress={() => handleRemove(entry.language)} hitSlop={8}>
            {removingLanguage === entry.language ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={styles.removeText}>{t('common.remove')}</Text>
            )}
          </Pressable>
        </View>
      ))}

      {isAdding ? (
        <View style={styles.form}>
          <FormInput
            placeholder={t('profile.cvLanguages.languagePlaceholder')}
            value={language}
            onChangeText={setLanguage}
          />
          <ChipSelect options={levelOptions} value={level} onChange={(v) => setLevel(v as LanguageLevel)} />
          <ErrorText>{error}</ErrorText>
          <PrimaryButton title={t('common.add')} onPress={handleAdd} loading={isSaving} disabled={!language} />
          <Pressable onPress={() => setIsAdding(false)}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setIsAdding(true)}>
          <Text style={styles.addText}>{t('profile.cvLanguages.addLink')}</Text>
        </Pressable>
      )}
    </Section>
  );
}

// --- FR-PRO-011 : recommandations reçues — consentement actif avant publication ---------
// (CLAUDE.md §5) : une recommandation reste masquée tant que le titulaire ne l'a pas
// explicitement affichée, même une fois l'organisation émettrice ayant agi.

function RecommendationsSection({
  accessToken,
  recommendations,
  onChanged,
}: {
  accessToken: string;
  recommendations: Recommendation[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(recommendation: Recommendation) {
    setError(null);
    setBusyId(recommendation.id);
    try {
      if (recommendation.visible) {
        await api.hideRecommendation(accessToken, recommendation.id);
      } else {
        await api.showRecommendation(accessToken, recommendation.id);
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.actionError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Section title={t('profile.recommendations.title')}>
      <Text style={styles.hint}>{t('profile.recommendations.hint')}</Text>
      {recommendations.map((recommendation) => (
        <Card key={recommendation.id} style={styles.recommendationCard}>
          <View style={styles.enrollmentHeader}>
            <Badge
              label={
                recommendation.visible
                  ? t('profile.recommendations.visible')
                  : t('profile.recommendations.hidden')
              }
              tone={recommendation.visible ? 'success' : 'neutral'}
            />
          </View>
          <Text style={styles.recommendationMessage}>{recommendation.message}</Text>
          <Pressable
            onPress={() => toggle(recommendation)}
            disabled={busyId !== null}
            hitSlop={8}
          >
            {busyId === recommendation.id ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.addText}>
                {recommendation.visible
                  ? t('profile.recommendations.hide')
                  : t('profile.recommendations.show')}
              </Text>
            )}
          </Pressable>
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

// --- Langue de l'application (FR/EN/ES/AR) ------------------------------------------------

function AppLanguageSection() {
  const { t, i18n } = useTranslation();
  const [isChanging, setIsChanging] = useState(false);
  const [reloadNotice, setReloadNotice] = useState(false);

  async function handleChange(next: string) {
    const language = next as AppLanguage;
    if (language === i18n.language) return;
    setIsChanging(true);
    setReloadNotice(false);
    try {
      // Web applique le sens d'écriture immédiatement (attribut `dir`) ; seul le natif
      // (iOS/Android) a besoin d'un redémarrage complet pour que I18nManager s'applique.
      const { reloadRequired } = await setAppLanguage(language);
      if (reloadRequired) setReloadNotice(true);
    } finally {
      setIsChanging(false);
    }
  }

  return (
    <Section title={t('profile.language.sectionTitle')}>
      <Text style={styles.hint}>{t('profile.language.hint')}</Text>
      <ChipSelect
        options={SUPPORTED_LANGUAGES.map((entry) => ({
          value: entry.code,
          label: entry.nativeLabel,
        }))}
        value={i18n.language}
        onChange={handleChange}
      />
      {isChanging && <ActivityIndicator color={colors.primary} />}
      {reloadNotice && <Text style={styles.hint}>{t('profile.language.reloadNotice')}</Text>}
    </Section>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    paddingBottom: 48,
    gap: 8,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 8,
  },
  form: {
    gap: 12,
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: 13,
    color: colors.muted,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listItemContent: {
    flex: 1,
    gap: 2,
  },
  listItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  listItemSubtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  listItemDates: {
    fontSize: 12,
    color: colors.muted,
  },
  enrollmentItem: {
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  enrollmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  enrollmentActions: {
    flexDirection: 'row',
    gap: 12,
  },
  enrollmentButton: {
    flex: 1,
  },
  recommendationCard: {
    gap: 8,
  },
  recommendationMessage: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  removeText: {
    fontSize: 13,
    color: colors.error,
  },
  addText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '600',
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  securityLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  logout: {
    marginTop: 24,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 14,
    color: colors.error,
  },
});
