import type { ApplicationStatus } from './api';

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  SUBMITTED: 'Envoyée',
  UNDER_REVIEW: "En cours d'examen",
  ADDITIONAL_DOCUMENT_REQUESTED: 'Document complémentaire demandé',
  INTERVIEW_PROPOSED: 'Entretien proposé',
  INTERVIEW_CONFIRMED: 'Entretien confirmé',
  ADMISSION_LETTER_SENT: "Lettre d'admission reçue",
  ACCEPTED: 'Acceptée',
  AWAITING_TRAVEL_CONSENT: "En attente d'accord parental",
  REJECTED: 'Non retenue',
  WITHDRAWN: 'Retirée',
  COMPLETED: 'Terminée',
};

export type StatusTone = 'primary' | 'accent' | 'neutral' | 'success' | 'error';

export const APPLICATION_STATUS_TONE: Record<ApplicationStatus, StatusTone> = {
  SUBMITTED: 'neutral',
  UNDER_REVIEW: 'neutral',
  ADDITIONAL_DOCUMENT_REQUESTED: 'accent',
  INTERVIEW_PROPOSED: 'accent',
  INTERVIEW_CONFIRMED: 'accent',
  ADMISSION_LETTER_SENT: 'accent',
  ACCEPTED: 'success',
  AWAITING_TRAVEL_CONSENT: 'accent',
  REJECTED: 'error',
  WITHDRAWN: 'error',
  COMPLETED: 'success',
};

export const ARTIFACT_KIND_LABELS = {
  ADMISSION_LETTER: "Lettre d'admission",
  CONVENTION: 'Convention de stage',
  ATTESTATION: 'Attestation de fin de stage',
} as const;
