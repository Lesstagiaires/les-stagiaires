import {
  OrganizationCategory,
  OrganizationType,
} from '../../generated/prisma/enums';

// ============================================================================
// V6-3 — CORRESPONDANCE CATÉGORIE → FAMILLE
//
// Isolée dans son propre fichier, comme `derivation-intention.ts` en V6-1, et
// pour la même raison : une table de correspondance métier noyée au milieu d'un
// service finit toujours par être « complétée » au fil des besoins. Ici, toute
// modification saute aux yeux dans un diff et fait tomber un test dédié.
//
//   FAMILLE ENTREPRISE      FAMILLE ETABLISSEMENT
//   ------------------      ---------------------
//   COMPANY                 SCHOOL
//   STARTUP                 UNIVERSITY
//   NGO                     TRAINING_CENTER
//   INSTITUTION
//
// CE QUE CETTE TABLE N'EST PAS. Elle ne sert à aucune décision de tarification,
// d'entitlement, d'autorisation ni de commission. Elle sert exactement à deux
// choses : vérifier qu'une catégorie déclarée est cohérente avec la famille de
// l'organisation, et rien d'autre. La formule d'abonnement continue d'être
// dérivée de `Organization.type`, jamais d'ici.
//
// POURQUOI `INSTITUTION` EST DU CÔTÉ ENTREPRISE. Le mot désigne ici une
// institution au sens d'organisation constituée — administration, organisme
// public — et non un établissement d'enseignement. Les trois catégories
// d'enseignement sont SCHOOL, UNIVERSITY et TRAINING_CENTER. La proximité avec
// le plan d'abonnement `INSTITUTION` est une homonymie, et il ne faut surtout
// pas en déduire un lien : ce plan-là dépend de la FAMILLE établissement.
// ============================================================================

export const FAMILLE_DE_LA_CATEGORIE: Record<
  OrganizationCategory,
  OrganizationType
> = {
  [OrganizationCategory.COMPANY]: OrganizationType.ENTREPRISE,
  [OrganizationCategory.STARTUP]: OrganizationType.ENTREPRISE,
  [OrganizationCategory.NGO]: OrganizationType.ENTREPRISE,
  [OrganizationCategory.INSTITUTION]: OrganizationType.ENTREPRISE,
  [OrganizationCategory.SCHOOL]: OrganizationType.ETABLISSEMENT,
  [OrganizationCategory.UNIVERSITY]: OrganizationType.ETABLISSEMENT,
  [OrganizationCategory.TRAINING_CENTER]: OrganizationType.ETABLISSEMENT,
};

// Les catégories admissibles pour une famille donnée. Sert à la vérification de
// cohérence côté serveur, et permettrait à une interface de ne proposer que ce
// qui est acceptable — sans jamais que l'interface devienne la garantie.
export function categoriesDeLaFamille(
  famille: OrganizationType,
): OrganizationCategory[] {
  return Object.values(OrganizationCategory).filter(
    (categorie) => FAMILLE_DE_LA_CATEGORIE[categorie] === famille,
  );
}
