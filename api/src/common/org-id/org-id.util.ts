import { randomInt } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0/I/1 pour éviter la confusion à la lecture

// FR-ORG-001 : identifiant d'affichage d'une organisation — même style que le LS-ID pour
// rester cohérent et lisible à l'oral (support/entretien).
export function generateOrgIdCandidate(countryCode: string): string {
  const year = new Date().getFullYear();
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `ORG-${countryCode.toUpperCase()}-${year}-${suffix}`;
}
