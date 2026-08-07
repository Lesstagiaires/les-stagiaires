// amountMinor est toujours en unité mineure (ex. centimes) — jamais de nombre à virgule
// flottante pour de l'argent côté serveur (voir api/src/subscriptions/). Cet helper
// centralise la seule conversion d'affichage nécessaire côté mobile.
export function formatAmountMinor(
  amountMinor: number,
  currency: string,
  locale: string,
): string {
  return `${(amountMinor / 100).toLocaleString(locale)} ${currency}`;
}
