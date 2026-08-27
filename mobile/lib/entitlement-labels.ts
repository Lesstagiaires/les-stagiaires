import type { EntitlementCapability } from './api';

export const ENTITLEMENT_LABELS_FR: Record<EntitlementCapability, string> = {
  GMAIL_ACCOUNT_OPENING_ASSISTANCE: 'Aide à l’ouverture d’un compte Gmail',
  CV_AND_COVER_LETTER_ASSISTANCE: 'Montage et révision du CV et de la lettre de motivation',
  LEGAL_CONTENTION_ASSISTANCE: 'Assistance juridique en cas de contentieux',
  PERSONALITY_ORIENTATION_REPORT: 'Test de personnalité et d’orientation avec rapport',
  EXPLANATION_REQUEST_WRITING_ASSISTANCE: 'Aide à la rédaction de demandes d’explications',
  DATA_PROTECTION_ASSISTANCE: 'Assistance pour la protection des données',
  PROFESSIONAL_INTERNSHIP_APPLICATION: 'Candidature à des stages professionnels',
};

export function libellesEntitlements(
  entitlements: readonly EntitlementCapability[],
): string[] {
  return entitlements.map((entitlement) => ENTITLEMENT_LABELS_FR[entitlement]);
}