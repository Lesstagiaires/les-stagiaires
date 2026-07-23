// Année-mois-jour LOCAUX plutôt que toISOString() (conversion UTC) : construire la
// date ainsi évite qu'elle recule d'un jour dans un fuseau horaire à l'est d'UTC
// (ex. WAT/UTC+1 au Cameroun). Voir components/date-input.web.tsx pour le même piège.
export function toIsoDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromIsoDateString(value: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDisplayDate(value: string | null): string {
  const date = fromIsoDateString(value);
  if (!date) return '';
  return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short' });
}
