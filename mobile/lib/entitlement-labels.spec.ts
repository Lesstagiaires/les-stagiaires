import { libellesEntitlements } from './entitlement-labels';
import type { EntitlementCapability } from './api';

const CAPABILITIES: Record<string, EntitlementCapability> = {
  GMAIL_ACCOUNT_OPENING_ASSISTANCE: 'GMAIL_ACCOUNT_OPENING_ASSISTANCE',
  CV_AND_COVER_LETTER_ASSISTANCE: 'CV_AND_COVER_LETTER_ASSISTANCE',
  LEGAL_CONTENTION_ASSISTANCE: 'LEGAL_CONTENTION_ASSISTANCE',
  PERSONALITY_ORIENTATION_REPORT: 'PERSONALITY_ORIENTATION_REPORT',
  EXPLANATION_REQUEST_WRITING_ASSISTANCE: 'EXPLANATION_REQUEST_WRITING_ASSISTANCE',
  DATA_PROTECTION_ASSISTANCE: 'DATA_PROTECTION_ASSISTANCE',
};

const labels = libellesEntitlements([
  CAPABILITIES.GMAIL_ACCOUNT_OPENING_ASSISTANCE,
  CAPABILITIES.CV_AND_COVER_LETTER_ASSISTANCE,
  CAPABILITIES.LEGAL_CONTENTION_ASSISTANCE,
]);

const expectedAcademicLabels = [
  'Aide à l’ouverture d’un compte Gmail',
  'Montage et révision du CV et de la lettre de motivation',
  'Assistance juridique en cas de contentieux',
];

if (JSON.stringify(labels) !== JSON.stringify(expectedAcademicLabels)) {
  throw new Error('Les libellés français académiques sont incorrects.');
}

if (
  libellesEntitlements([
    CAPABILITIES.PERSONALITY_ORIENTATION_REPORT,
    CAPABILITIES.EXPLANATION_REQUEST_WRITING_ASSISTANCE,
    CAPABILITIES.DATA_PROTECTION_ASSISTANCE,
  ]).length !== 3
) {
  throw new Error('Les libellés français professionnels sont incomplets.');
}