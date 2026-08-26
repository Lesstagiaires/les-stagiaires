import { createHash } from 'crypto';
import {
  NotificationType,
  SweepIncidentKind,
} from '../../generated/prisma/enums';

// ============================================================================
// LES CONVENTIONS DE LA SUPERVISION, ET ELLES SEULES
//
// FICHIER ISOLÉ, comme `plancher-parcours.ts` pour D-21 et
// `subscription-notice-types.ts` pour V6-5. Une constante de seuil noyée dans un
// service finit toujours par être « ajustée » au fil des incidents ; ici, toute
// modification saute aux yeux dans un diff et casse un test dédié.
//
// CE QUI EST MESURÉ ET CE QUI EST CONVENU. Presque tout ce que la supervision
// utilise est LU dans Redis : le nom des files, leur cadence (`every`), l'instant
// planifié non honoré (`next`), l'identifiant d'un job échoué. Rien de cela n'est
// recopié ici. La seule valeur conventionnelle du dispositif est K ci-dessous.
// ============================================================================

// ----------------------------------------------------------------------------
// K — LE SEUL NOMBRE ARBITRAIRE DU CHANTIER
//
// Une file est anormalement en retard lorsque `maintenant − next > K × every`.
//
// K MULTIPLIE LA CADENCE DÉCLARÉE, il ne fixe pas un délai. C'est ce qui permet
// à une file horaire et à une file quotidienne de partager la même règle sans
// qu'aucune cadence ne soit dupliquée dans ce module : 3 h pour l'une, 72 h pour
// l'autre, et rien à tenir à jour si une cadence change.
//
// K = 3 et non 1 : un déploiement, un redémarrage ou une lenteur passagère font
// manquer une itération sans que rien ne soit en panne. Alerter au premier
// manquement apprendrait à ignorer l'alerte.
// ----------------------------------------------------------------------------
export const K_TOLERANCE = 3;

export function estAnormalementEnRetard(
  next: number,
  every: number,
  maintenant: number,
): boolean {
  return maintenant - next > K_TOLERANCE * every;
}

// Le sentinelle des incidents qui ne visent aucune file en particulier. NON NUL
// à dessein : deux `null` n'entrent jamais en collision dans un index unique
// PostgreSQL, et la déduplication du réveil s'effondrerait sans bruit.
export const TOUTES_LES_FILES = '*';

export const NOTIFICATION_DE_L_INCIDENT: Record<
  SweepIncidentKind,
  NotificationType
> = {
  [SweepIncidentKind.RETARD]: NotificationType.SWEEP_DELAY_DETECTED,
  [SweepIncidentKind.ECHEC]: NotificationType.SWEEP_JOB_FAILED,
  [SweepIncidentKind.REVEIL]: NotificationType.SWEEP_SILENCE_ON_STARTUP,
};

// ----------------------------------------------------------------------------
// LES IDENTITÉS D'ÉPISODE
//
// Toutes sont construites à partir de FAITS PARTAGÉS, lus dans Redis, jamais
// d'une horloge locale. C'est la propriété qui fait que deux superviseurs
// concurrents calculent la même clé et que l'index unique n'en laisse passer
// qu'un — sans verrou, sans temporisation, sans coordination.
// ----------------------------------------------------------------------------

// RETARD — l'instant planifié qui n'a pas été honoré.
//
// Mesuré le 2026-08-25 : `subscription-expiry` portait encore
// `next = 2026-08-11T08:24Z`, quatorze jours après. Tant que rien ne tourne, la
// valeur ne bouge pas ; dès la reprise, elle avance. D'où trois propriétés
// obtenues sans rien écrire :
//   — une panne persistante ne produit qu'une alerte ;
//   — une reprise ferme l'épisode, puisque l'identité n'est plus productible ;
//   — une rechute en ouvre un nouveau, avec un `next` neuf.
//
// Le `schedulerId` est inclus bien qu'aucune file n'ait aujourd'hui plus d'un
// planificateur — mesuré. L'inclure supprime une hypothèse plutôt que de la
// porter.
export function identiteRetard(schedulerId: string, next: number): string {
  return `${schedulerId}:${next}`;
}

// ÉCHEC — l'identifiant du job, immuable dans BullMQ. Un job qui échoue à
// nouveau en porte un autre, donc ouvre un autre épisode.
export function identiteEchec(jobId: string): string {
  return jobId;
}

// RÉVEIL — l'empreinte de l'ensemble des files trouvées silencieuses.
//
// AUCUNE HORLOGE N'Y ENTRE, et c'est le point : deux instances qui démarrent
// ensemble observent le même Redis, calculent la même empreinte, et une seule
// notification part. Un horodatage de démarrage en aurait produit deux.
//
// L'empreinte change dès qu'une file entre ou sort de l'ensemble, ou qu'un
// `next` avance — donc une interruption ultérieure alerte bien à nouveau. Et une
// file durablement orpheline, dont la contribution est constante, ne fige pas la
// clé des autres.
export function identiteReveil(
  silencieuses: readonly {
    queueName: string;
    schedulerId: string;
    next: number;
  }[],
): string {
  const canonique = [...silencieuses]
    .map((f) => `${f.queueName}:${f.schedulerId}:${f.next}`)
    .sort()
    .join('|');
  return createHash('sha256').update(canonique).digest('hex');
}
