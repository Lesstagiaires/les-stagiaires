import type { Prisma } from '../../generated/prisma/client';
import type {
  AmbassadorDecisionReason,
  PayoutRequestStatus,
} from '../../generated/prisma/enums';

type Db =
  | Prisma.TransactionClient
  | { payoutEvent: { create: (args: unknown) => unknown } };

// ============================================================================
// JOURNAL DES VERSEMENTS
//
// « Chaque étape doit enregistrer : l'auteur ; la date ; le montant ; la devise ;
// la destination masquée ; la référence ; le statut ; le motif lorsqu'il y a
// refus ou échec. » — arbitrage 12 du promoteur, 2026-08-02.
//
// UNE SEULE PORTE D'ÉCRITURE, et elle masque. Le masquage ne peut pas être
// oublié à un appel puisqu'il n'est pas à la charge de l'appelant : la fonction
// reçoit le libellé complet et n'écrit jamais que sa forme masquée. C'est la
// même logique que les motifs communicables — une garantie STRUCTURELLE plutôt
// qu'une discipline à tenir.
// ============================================================================

// Ne conserve que les quatre derniers chiffres de toute suite longue, en laissant
// intact le libellé lisible (« MTN MoMo — Awa N. »). Quatre chiffres suffisent à
// ce que le titulaire reconnaisse son compte, et ne suffisent à personne d'autre.
//
// Volontairement dupliqué depuis email-templates : ce masque-ci protège la BASE,
// celui-là protège un rendu. Les faire dépendre l'un de l'autre ferait qu'un
// changement de gabarit d'e-mail modifierait ce qui est écrit au journal.
export function maskPayoutDestination(
  value: string | null | undefined,
): string {
  if (!value) return '—';
  return value.replace(/\d{5,}/g, (digits) => `••••${digits.slice(-4)}`);
}

export interface PayoutJournalEntry {
  type: string;
  status: PayoutRequestStatus;
  actorId: string | null;
  amountMinor: number;
  currency: string;
  // DÉJÀ MASQUÉE. Depuis le chiffrement des coordonnées (2026-08-04), la forme
  // masquée est stockée en clair sur la demande : le journal la recopie sans
  // jamais rien déchiffrer. Le masque reste appliqué ci-dessous — il est
  // idempotent, et cette ceinture-là ne coûte rien.
  destinationMasked: string;
  reference?: string | null;
  reasonCode?: AmbassadorDecisionReason | null;
  internalNote?: string | null;
}

export async function journalPayout(
  db: Db,
  payoutRequestId: string,
  entry: PayoutJournalEntry,
) {
  await (db as Prisma.TransactionClient).payoutEvent.create({
    data: {
      payoutRequestId,
      type: entry.type,
      status: entry.status,
      actorId: entry.actorId,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      destinationMasked: maskPayoutDestination(entry.destinationMasked),
      reference: entry.reference ?? null,
      reasonCode: entry.reasonCode ?? null,
      internalNote: entry.internalNote ?? null,
    },
  });
}
