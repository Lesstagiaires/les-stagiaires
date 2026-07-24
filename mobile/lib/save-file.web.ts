// Web : déclenche un téléchargement classique via un lien <a download> éphémère —
// aucune permission ni feuille de partage nécessaire côté navigateur.
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
