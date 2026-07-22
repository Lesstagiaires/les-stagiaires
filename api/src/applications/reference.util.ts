import { randomInt } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0/I/1 pour éviter la confusion à la lecture

// FR-M5-003 : référence de candidature — même style que le LS-ID pour rester cohérent
// et lisible à l'oral (support/entretien).
export function generateApplicationReference(): string {
  const year = new Date().getFullYear();
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `CAND-${year}-${suffix}`;
}
