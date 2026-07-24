import type { TextStyle, ViewStyle } from 'react-native';

// Palette alignée sur l'identité du logo : bleu marine profond en couleur principale,
// orange en accent (actions/mises en avant) — le vert est réservé exclusivement aux
// états de validation et de succès (jamais utilisé comme couleur de marque générique),
// échelle neutre élargie pour distinguer fond de page, surface de carte et bordures
// plutôt que de tout confondre en un seul gris.
export const colors = {
  primary: '#1B2A4A',
  primaryDark: '#12203A',
  primaryLight: '#E7EAF1',
  accent: '#F2901E',
  accentDark: '#C46E0A',
  accentLight: '#FCEBD8',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F8F7',
  text: '#16211C',
  textSecondary: '#4B5A52',
  muted: '#8A968F',
  border: '#E4E9E6',
  error: '#C0392B',
  errorLight: '#FBEAE8',
  // Réservé aux états de validation/succès (candidature acceptée, document validé,
  // organisation vérifiée...) — jamais utilisé comme synonyme de "primary".
  success: '#0F6E56',
  successLight: '#E1F5EE',
  warning: '#C46E0A',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

// Ombres douces (natif : shadow*, web/Android : elevation) — un seul jeu de valeurs
// couvrant les deux moteurs de rendu plutôt que de dupliquer par plateforme.
export const shadow: Record<'sm' | 'md' | 'lg', ViewStyle> = {
  sm: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  lg: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 9,
  },
};

export const typography: Record<
  'h1' | 'h2' | 'h3' | 'body' | 'bodyBold' | 'caption' | 'label',
  TextStyle
> = {
  h1: { fontSize: 28, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  h2: { fontSize: 22, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  h3: { fontSize: 17, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, fontWeight: '400', color: colors.text },
  bodyBold: { fontSize: 15, fontWeight: '600', color: colors.text },
  caption: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  label: { fontSize: 12, fontWeight: '700', color: colors.muted, letterSpacing: 0.4 },
};
