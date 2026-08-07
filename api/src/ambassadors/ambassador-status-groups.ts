import { AmbassadorStatus } from '../../generated/prisma/enums';

// ============================================================================
// GROUPES DE STATUTS NOMMÉS
//
// Arbitrage du promoteur du 2026-08-02 : conserver la candidature dans
// `Ambassador` plutôt que d'en faire une entité séparée, mais « avec des groupes
// de statuts nommés ».
//
// POURQUOI DES GROUPES, ET PAS DES LISTES ÉCRITES SUR PLACE. Onze statuts, et
// des questions qui reviennent partout : ce dossier est-il encore en
// instruction ? peut-il percevoir ? peut-on lui attribuer un filleul ? Écrire la
// réponse à chaque appel, c'est garantir qu'un jour l'une des copies oubliera un
// statut — et une commission versée à un ambassadeur résilié ne se rattrape pas.
//
// Ici, chaque question a UN seul endroit où elle est répondue.
//
// LE GARDE-FOU D'EXHAUSTIVITÉ. `ALL_STATUSES` est typé de sorte qu'ajouter un
// statut à l'énumération sans le classer casse la compilation
// (`ambassador-status-groups.spec.ts`). Un statut non classé serait pire qu'un
// statut absent : il traverserait les contrôles sans que personne ne le voie.
// ============================================================================

// --- Instruction du dossier -------------------------------------------------
// Le dossier est en cours d'examen. Aucun droit, aucune attribution, aucun code.
export const APPLICATION_STATUSES = [
  AmbassadorStatus.SUBMITTED,
  AmbassadorStatus.UNDER_REVIEW,
  AmbassadorStatus.ADDITIONAL_INFORMATION_REQUIRED,
  AmbassadorStatus.VERIFIED,
  AmbassadorStatus.APPROVED,
  AmbassadorStatus.CONTRACT_PENDING,
  AmbassadorStatus.TRAINING_PENDING,
] as const;

// --- Vie opérationnelle -----------------------------------------------------
// Le dossier existe et vit. SUSPENDED en fait partie : un ambassadeur suspendu
// n'est pas sorti du programme, il est arrêté — ses droits acquis demeurent.
export const OPERATIONAL_STATUSES = [
  AmbassadorStatus.ACTIVE,
  AmbassadorStatus.SUSPENDED,
] as const;

// --- Fin de parcours --------------------------------------------------------
// Aucune reprise possible depuis ces états. Une nouvelle candidature, oui ; une
// réactivation, non.
export const TERMINAL_STATUSES = [
  AmbassadorStatus.TERMINATED,
  AmbassadorStatus.REJECTED,
] as const;

// --- Percevoir --------------------------------------------------------------
// QUI PEUT RECEVOIR DE L'ARGENT. Volontairement le plus étroit de tous les
// groupes : seul un ambassadeur ACTIF perçoit.
//
// Un suspendu n'y figure pas — c'est le sens même d'une suspension. Ses
// commissions déjà acquises restent à lui et lui seront versées à sa
// réintégration : c'est le versement qui s'arrête, pas la créance.
export const PAYMENT_ELIGIBLE_STATUSES = [AmbassadorStatus.ACTIVE] as const;

// --- Se voir attribuer ------------------------------------------------------
// QUI PEUT RECEVOIR UN FILLEUL OU UNE ENTREPRISE. Là encore ACTIVE seul.
//
// La distinction avec le groupe précédent n'est pas cosmétique : ils répondent à
// deux questions différentes, et le jour où un niveau « probatoire » pourra
// attribuer sans encore percevoir, un seul des deux bougera.
export const ATTRIBUTION_ELIGIBLE_STATUSES = [AmbassadorStatus.ACTIVE] as const;

// --- Le garde-fou -----------------------------------------------------------
// Tout statut doit appartenir à exactement un des trois groupes structurants.
// Les deux groupes de droits (percevoir, attribuer) sont des sous-ensembles et
// ne comptent pas dans cette partition.
export const ALL_CLASSIFIED_STATUSES = [
  ...APPLICATION_STATUSES,
  ...OPERATIONAL_STATUSES,
  ...TERMINAL_STATUSES,
] as const;

const inGroup = <T extends readonly AmbassadorStatus[]>(
  group: T,
  status: AmbassadorStatus,
): boolean => (group as readonly AmbassadorStatus[]).includes(status);

// Le dossier est-il encore en instruction ?
export const isApplicationStage = (status: AmbassadorStatus): boolean =>
  inGroup(APPLICATION_STATUSES, status);

// Le parcours est-il définitivement clos ?
export const isTerminal = (status: AmbassadorStatus): boolean =>
  inGroup(TERMINAL_STATUSES, status);

// Peut-il percevoir ?
export const canBePaid = (status: AmbassadorStatus): boolean =>
  inGroup(PAYMENT_ELIGIBLE_STATUSES, status);

// Peut-on lui attribuer un filleul ou une entreprise ?
export const canReceiveAttribution = (status: AmbassadorStatus): boolean =>
  inGroup(ATTRIBUTION_ELIGIBLE_STATUSES, status);
