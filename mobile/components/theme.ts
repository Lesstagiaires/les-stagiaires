import type { TextStyle, ViewStyle } from 'react-native';

// Palette : vert profond (identité déjà en place) + accent ambre chaleureux pour les
// actions/mises en avant, échelle neutre élargie pour distinguer fond de page, surface
// de carte et bordures plutôt que de tout confondre en un seul gris.
export const colors = {
  primary: '#0B6E4F',
  primaryDark: '#095A40',
  primaryLight: '#E3F2EC',
  accent: '#F2A93B',
  accentDark: '#C97F12',
  accentLight: '#FDF1DD',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F8F7',
  text: '#16211C',
  textSecondary: '#4B5A52',
  muted: '#8A968F',
  border: '#E4E9E6',
  error: '#C0392B',
  errorLight: '#FBEAE8',
  success: '#0B6E4F',
  warning: '#C97F12',
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
    shadowColor: '#0F1F17',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#0F1F17',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  lg: {
    shadowColor: '#0F1F17',
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
