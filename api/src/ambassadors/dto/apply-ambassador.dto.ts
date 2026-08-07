import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { AmbassadorCategory } from '../../../generated/prisma/enums';

// Dépôt d'une candidature au programme Ambassadeurs, par la personne elle-même.
//
// « Un candidat ne devient JAMAIS ambassadeur automatiquement » (arbitrage du
// promoteur). Ce formulaire OUVRE UN DOSSIER — il ne confère aucun droit, aucun
// code d'affiliation, aucune capacité d'attribution. Tout le reste est
// instruit par l'administration.
//
// CE QUI N'EST PAS DEMANDÉ, ET C'EST DÉLIBÉRÉ :
//
//   — AUCUN DIPLÔME. Arbitrage explicite du promoteur : le programme s'adresse
//     à des gens qui savent convaincre, pas à des gens qui savent produire un
//     parchemin. Demander un diplôme écarterait précisément ceux que LES
//     STAGIAIRES existe pour servir.
//   — AUCUNE PIÈCE D'IDENTITÉ À CE STADE. Elle relève du niveau « Très
//     sensible » (CLAUDE.md §1) et se dépose plus tard, dans le Coffre-fort
//     chiffré, quand le dossier a franchi le premier examen. Réclamer une carte
//     d'identité pour un formulaire qui sera peut-être refusé d'emblée, c'est
//     collecter au-delà du nécessaire.
//   — AUCUN CHAMP « au cas où ». Minimisation des données (RGPD, CLAUDE.md §5).
//
// L'ÂGE ET LE PAYS ne figurent pas non plus ici : ils sont LUS SUR LE COMPTE, et
// non déclarés dans le formulaire. Se fier à une date de naissance ressaisie
// reviendrait à laisser le candidat choisir s'il est majeur.
export class ApplyAmbassadorDto {
  // Ce sur quoi porte l'instruction. Un seuil de longueur qui oblige à écrire
  // quelques phrases : une candidature en trois mots n'est pas instruisable, et
  // la refuser ensuite ferait perdre du temps aux deux parties.
  @IsString()
  @Length(50, 2000)
  @Matches(/^[^<>{}\\]*$/, {
    message: 'La motivation ne peut pas contenir de balisage (< > { } \\).',
  })
  motivation: string;

  // CAMPUS (parrainage de jeunes) ou BUSINESS (rattachement d'entreprises). Une
  // personne peut viser les deux ; l'administration tranchera.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsEnum(AmbassadorCategory, { each: true })
  categories: AmbassadorCategory[];
}
