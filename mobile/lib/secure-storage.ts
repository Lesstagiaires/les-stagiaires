import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// expo-secure-store (Keychain/Keystore chiffré) n'existe pas sur le web — on retombe
// sur localStorage pour la cible web (react-native-web), avec le même niveau de
// protection que n'importe quelle app web classique. Les tokens ne sont jamais
// conservés en clair ailleurs (CLAUDE.md §1 : "Confidentiel" → chiffrement).
export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
