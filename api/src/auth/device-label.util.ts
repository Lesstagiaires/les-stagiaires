// Étiquette lisible dérivée du User-Agent — approximation volontairement simple (pas de
// dépendance UA-parser) : suffisante pour qu'un utilisateur reconnaisse ses appareils
// dans la liste des sessions connectées (CLAUDE.md §2), pas une empreinte précise.
export function deriveDeviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return 'Appareil inconnu';

  const ua = userAgent.toLowerCase();

  let os = 'Appareil';
  if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('macintosh') || ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  let browser: string | null = null;
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome/') && !ua.includes('okhttp')) browser = 'Chrome';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';
  else if (ua.includes('okhttp') || ua.includes('cfnetwork')) browser = "Application mobile";

  return browser ? `${browser} sur ${os}` : os;
}
