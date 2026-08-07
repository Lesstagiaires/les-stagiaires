// ============================================================================
// ENTRÉES DE DÉMONSTRATION DU JOURNAL D'AUDIT
//
// Le journal est en ajout seul : un déclencheur PostgreSQL refuse toute
// modification et toute suppression (migration 20260802140000). Une ligne écrite
// pour éprouver ce verrou ne peut donc plus être ni annotée, ni retirée — c'est
// la démonstration la plus littérale que le verrou fonctionne.
//
// Le promoteur a demandé (2026-08-02) que ces entrées restent présentes, mais
// soient « clairement documentées comme entrées de démonstration afin qu'aucun
// administrateur ne les interprète comme un événement métier réel ». Puisqu'on ne
// peut pas écrire dans la ligne, la documentation vit ICI, et le back-office s'en
// sert pour les afficher comme telles.
//
// AUCUNE de ces actions ne doit jamais être émise par du code métier.
// ============================================================================

export interface DemonstrationEntry {
  action: string;
  /** Ce que cette entrée prouve, en une phrase affichable à un administrateur. */
  purpose: string;
  /** Date de l'écriture, pour situer la ligne dans l'historique. */
  recordedOn: string;
}

export const DEMONSTRATION_AUDIT_ENTRIES: readonly DemonstrationEntry[] = [
  {
    action: 'TEST_APPEND_ONLY',
    purpose:
      "Écrite le 2026-08-02 pour vérifier que le journal d'audit refuse la modification et la suppression. Ce n'est pas un événement métier : aucune décision, aucun utilisateur et aucun partenariat n'y sont attachés.",
    recordedOn: '2026-08-02',
  },
] as const;

const DEMONSTRATION_ACTIONS = new Set(
  DEMONSTRATION_AUDIT_ENTRIES.map((entry) => entry.action),
);

// Une ligne d'audit est-elle une entrée de démonstration ?
//
// Sert au back-office pour l'estamper visuellement, et au script de préparation à
// la production pour ne pas la compter comme une donnée de recette résiduelle —
// elle est légitime et destinée à rester.
export function isDemonstrationAuditAction(action: string): boolean {
  return DEMONSTRATION_ACTIONS.has(action);
}

export function demonstrationEntryFor(
  action: string,
): DemonstrationEntry | undefined {
  return DEMONSTRATION_AUDIT_ENTRIES.find((entry) => entry.action === action);
}
