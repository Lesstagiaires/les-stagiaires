import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Natif : écrit dans le cache puis ouvre la feuille de partage système (l'utilisateur
// choisit où l'enregistrer réellement — Fichiers, Drive, etc.). Voir save-file.web.ts
// pour l'équivalent web (résolu automatiquement par Metro).
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  const base64 = await blobToBase64(blob);
  const dir = new Directory(Paths.cache, 'digital-safe');
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, fileName);
  if (file.exists) file.delete();
  file.write(base64, { encoding: 'base64' });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // dataURL au format "data:<mime>;base64,<data>" — seule la partie après la virgule
      // est un contenu base64 valide pour File.write().
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
