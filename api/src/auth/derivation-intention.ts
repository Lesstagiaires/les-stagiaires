import { UserIntent, UserPath } from '../../generated/prisma/enums';

// ============================================================================
// V6-1 — TABLE DE DÉRIVATION NORMATIVE
//
// Elle est reproduite ici EXACTEMENT telle que la gouvernance l'a arrêtée, et
// isolée dans son propre fichier pour une raison précise : une table de
// correspondance métier noyée au milieu d'un service finit toujours par être
// « complétée » au fil des besoins. Ici, toute modification saute aux yeux dans
// un diff et casse un test dédié.
//
//   initialIntent                   | rôle            | currentPath
//   --------------------------------|-----------------|--------------
//   ACADEMIC_INTERNSHIP_SEARCH      | JEUNE           | ACADEMIC
//   PROFESSIONAL_INTERNSHIP_SEARCH  | JEUNE           | PROFESSIONAL
//   ORGANIZATION                    | ENTREPRISE      | NULL
//   ESTABLISHMENT                   | ETABLISSEMENT   | NULL
//   GUARDIAN                        | PARENT          | NULL
//   AMBASSADOR                      | JEUNE           | NULL
//   (aucune intention)              | aucun rôle      | NULL
//
// POURQUOI AMBASSADOR DONNE `JEUNE` ET AUCUN PARCOURS. Un candidat ambassadeur
// crée d'abord un compte de personne physique ; le dossier Ambassador est une
// démarche distincte et postérieure, qui exige d'être authentifié. Devenir
// ambassadeur n'est pas une étape de carrière de stagiaire : `currentPath` reste
// donc nul.
//
// POURQUOI LES ORGANISATIONS N'ONT PAS DE PARCOURS. Le parcours décrit une
// personne dans sa progression professionnelle ; une entreprise n'en a pas. Le
// titulaire pourra toujours en déclarer un plus tard via PATCH /auth/me/path :
// le parcours appartient à la personne, jamais au rôle qu'elle exerce.
// ============================================================================

export const ROLE_INITIAL: Record<UserIntent, string> = {
  [UserIntent.ACADEMIC_INTERNSHIP_SEARCH]: 'JEUNE',
  [UserIntent.PROFESSIONAL_INTERNSHIP_SEARCH]: 'JEUNE',
  [UserIntent.ORGANIZATION]: 'ENTREPRISE',
  [UserIntent.ESTABLISHMENT]: 'ETABLISSEMENT',
  [UserIntent.GUARDIAN]: 'PARENT',
  [UserIntent.AMBASSADOR]: 'JEUNE',
};

export const PARCOURS_INITIAL: Record<UserIntent, UserPath | null> = {
  [UserIntent.ACADEMIC_INTERNSHIP_SEARCH]: UserPath.ACADEMIC,
  [UserIntent.PROFESSIONAL_INTERNSHIP_SEARCH]: UserPath.PROFESSIONAL,
  [UserIntent.ORGANIZATION]: null,
  [UserIntent.ESTABLISHMENT]: null,
  [UserIntent.GUARDIAN]: null,
  [UserIntent.AMBASSADOR]: null,
};
