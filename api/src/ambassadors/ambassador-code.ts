import { randomInt } from 'node:crypto';

// Alphabet volontairement amputé de I, O, S, U, 0, 1, 2, 5.
//
// Un code d'affiliation se transmet à l'oral, se recopie depuis une affiche, se
// dicte au téléphone : confondre O et 0, ou S et 5, ferait rater une attribution —
// donc perdre une commission. Retirer huit caractères coûte un peu d'entropie et
// évite toute une classe de litiges.
//
// Les caractères restants donnent 28^6, soit plus de 480 millions de combinaisons :
// largement de quoi tenir la croissance visée, avec de la marge pour les collisions.
const ALPHABET = '346789ABCDEFGHJKLMNPQRTVWXYZ';
const CODE_LENGTH = 6;

export function generateAmbassadorCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    // randomInt (node:crypto) plutôt que Math.random : un code d'affiliation
    // prévisible permettrait de deviner celui d'un autre et de détourner ses
    // filleuls.
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

// Tolère ce qu'un humain tape réellement : minuscules, espaces, tirets, et le
// préfixe « LS- » qu'on ajoute spontanément en recopiant une affiche.
export function normalizeAmbassadorCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, '').replace(/^LS/, '');
}
