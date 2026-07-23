import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { FormInput } from './form';

function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Natif uniquement — le web n'a pas d'implémentation dans
// @react-native-community/datetimepicker ("DateTimePicker is not supported on: web").
// Voir date-input.web.tsx pour l'équivalent web (résolu automatiquement par Metro).
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
  const [showPicker, setShowPicker] = useState(false);

  return (
    <>
      <Pressable onPress={() => setShowPicker(true)}>
        <View pointerEvents="none">
          <FormInput
            placeholder={placeholder}
            value={value ? formatDate(value) : ''}
            editable={false}
          />
        </View>
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={value ?? new Date(2000, 0, 1)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={maximumDate}
          onChange={(_event, selectedDate) => {
            setShowPicker(Platform.OS === 'ios');
            if (selectedDate) onChange(selectedDate);
          }}
        />
      )}
    </>
  );
}
