import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CountryCode } from 'libphonenumber-js';
import { getCountryDisplayName, type CountryOption } from '../lib/countries';
import { colors, radius, spacing, typography } from './theme';

export function CountrySelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
}: {
  options: CountryOption[];
  value: CountryCode | null;
  onChange: (code: CountryCode) => void;
  placeholder: string;
  searchPlaceholder: string;
}) {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((option) => option.code === value) ?? null;

  const filtered = useMemo(() => {
    const withNames = options.map((option) => ({
      ...option,
      name: getCountryDisplayName(option.code, i18n.language),
    }));
    const normalizedQuery = query.trim().toLowerCase();
    return withNames
      .filter((option) => !normalizedQuery || option.name.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [options, query, i18n.language]);

  function handleSelect(code: CountryCode) {
    onChange(code);
    setQuery('');
    setIsOpen(false);
  }

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setIsOpen(true)}>
        <Text style={selected ? styles.triggerText : styles.triggerPlaceholder}>
          {selected
            ? `${getCountryDisplayName(selected.code, i18n.language)} (+${selected.callingCode})`
            : placeholder}
        </Text>
      </Pressable>

      <Modal visible={isOpen} animationType="slide" onRequestClose={() => setIsOpen(false)}>
        <View style={styles.modalContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            autoFocus
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => handleSelect(item.code)}>
                <Text style={typography.body}>{item.name}</Text>
                <Text style={typography.caption}>+{item.callingCode}</Text>
              </Pressable>
            )}
          />
          <Pressable style={styles.closeButton} onPress={() => setIsOpen(false)}>
            <Text style={styles.closeButtonText}>✕</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  triggerText: {
    fontSize: 16,
    color: colors.text,
  },
  triggerPlaceholder: {
    fontSize: 16,
    color: colors.muted,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 64,
    paddingHorizontal: spacing.xl,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeButton: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.xl,
    padding: spacing.sm,
  },
  closeButtonText: {
    fontSize: 20,
    color: colors.muted,
  },
});
