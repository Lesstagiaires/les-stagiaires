import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

// ============================================================================
// LA FORME CANONIQUE D'UN NUMÉRO DE TUTEUR
//
// TOUT LE CYCLE DE REFUS REPOSE SUR CETTE FONCTION. Le délai de garde, le
// compteur de refus et la détection d'un vrai changement de tuteur sont tous
// indexés sur la clef (mineur, numéro). Si deux écritures du même téléphone
// donnent deux clefs, les trois garde-fous tombent ensemble.
//
// CE QUI A ÉTÉ CONSTATÉ. `@IsPhoneNumber` de class-validator VALIDE sans
// TRANSFORMER. Vérifié le 2026-08-08 :
//
//   "+237690001111"       VALIDE
//   "+237 690 00 11 11"   VALIDE
//   "+237-690-001-111"    VALIDE
//   → trois chaînes distinctes, un seul téléphone
//
// Un mineur pouvait donc relancer son tuteur autant de fois qu'il voulait en
// ajoutant un espace, et un parent ayant refusé se retrouvait sollicité par le
// mécanisme même censé enregistrer son refus.
//
// ON NE FAIT PAS CE TRAVAIL À LA MAIN. Retirer les espaces et les tirets ne
// suffit pas : il faut connaître les plans de numérotation nationaux — préfixe
// international, zéro de tête à retirer ou à garder, longueurs valides.
// `libphonenumber-js` les connaît ; nous, non.
// ============================================================================

// La forme E.164 : « + », indicatif pays, numéro national, sans séparateur.
// C'est ce que la base stocke, et ce sur quoi porte la contrainte d'unicité.
export function normalizeParentPhone(raw: string): string {
  const parsed = parsePhoneNumberFromString(raw);

  // FAIL-CLOSED. Un numéro que la bibliothèque ne sait pas interpréter ne doit
  // pas être écrit tel quel « au cas où » : il créerait précisément la clef
  // divergente que cette fonction existe pour empêcher.
  if (!parsed?.isValid()) {
    throw new BadRequestException(
      'Numéro de téléphone du parent/tuteur invalide (format international requis).',
    );
  }

  return parsed.number;
}

// Deux saisies désignent-elles le même téléphone ?
//
// Utilisé pour distinguer un VRAI changement de tuteur d'une simple variation
// d'écriture. Sans cela, un mineur contournerait la procédure de changement en
// resaisissant le même numéro autrement.
//
// Accepte `null` parce que `User.phone` est nullable (un compte peut avoir été
// créé par adresse électronique). Un numéro absent n'est le même que personne :
// répondre `false` est ici le comportement PRUDENT, et non un fail-open — il
// laisse simplement passer un contrôle d'auto-désignation qui n'a plus d'objet,
// puisqu'un compte sans téléphone ne peut de toute façon pas recevoir le SMS
// qu'il chercherait à s'envoyer à lui-même.
export function isSameParentPhone(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  try {
    return normalizeParentPhone(a) === normalizeParentPhone(b);
  } catch {
    // Un numéro illisible n'est « le même » que personne : on préfère répondre
    // non plutôt que de laisser passer une comparaison qui n'a pas de sens.
    return false;
  }
}
