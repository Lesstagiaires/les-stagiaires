import { createElement } from 'react';
import { StyleSheet } from 'react-native';
import { colors } from './form';

// Formatage manuel (année-mois-jour LOCAUX) plutôt que toISOString(), qui convertit
// en UTC et peut faire reculer la date d'un jour dans un fuseau horaire à l'est
// d'UTC (ex. WAT/UTC+1 au Cameroun) — même piège que dans onChange ci-dessous.
function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Équivalent web de date-input.tsx (résolu automatiquement par Metro pour la cible
// web) : @react-native-community/datetimepicker n'a aucune implémentation web, donc
// un <input type="date"> natif du navigateur est utilisé directement plutôt qu'un
// champ silencieusement inopérant.
export function DateInput({
  value,
  onChange,
  placeholder,
  maximumDate,
}: {
  value: Date | null;
  onChange: (date: Date) => void;
  placeholder: string;
  maximumDate?: Date;
}) {
  return createElement('input', {
    type: 'date',
    value: value ? toIsoDate(value) : '',
    max: maximumDate ? toIsoDate(maximumDate) : undefined,
    placeholder,
    style: styles.input,
    onChange: (event: { target: { value: string } }) => {
      const raw = event.target.value;
      if (!raw) return;
      // Parsing manuel (année-mois-jour) : new Date("YYYY-MM-DD") interprète la
      // chaîne en UTC minuit, ce qui peut faire reculer la date d'un jour dans un
      // fuseau horaire à l'ouest de UTC (ex. tôt le matin en Amérique) — ici l'heure
      // locale reste à minuit local, pas UTC.
      const [year, month, day] = raw.split('-').map(Number);
      onChange(new Date(year, month - 1, day));
    },
  });
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
    fontFamily: 'inherit',
  },
});
