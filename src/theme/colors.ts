/**
 * Mango × QVAC — Theme system
 * Memoized color palette for dark/light modes.
 */
export interface ThemeColors {
  bg: string;
  surface: string;
  card: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  userBubble: string;
  assistantBubble: string;
  yellow: string;
  green: string;
  orange: string;
  destructive: string;
  mutedText: string;
  codeBg: string;
  codeBorder: string;
}

const DARK: ThemeColors = {
  bg: '#0F1115',
  surface: '#1A1D23',
  card: '#222630',
  border: '#333845',
  textPrimary: '#F5F7FA',
  textSecondary: '#AEB4C0',
  accent: '#4D9EFF',
  userBubble: '#2563EB',
  assistantBubble: '#2A2F3A',
  yellow: '#FBB824',
  green: '#4ADE80',
  orange: '#FB923C',
  destructive: '#F87171',
  mutedText: '#8B92A0',
  codeBg: '#161A22',
  codeBorder: '#3A4150',
};

// ponytail: light palette given the same AA discipline as dark — surfaces step
// up from bg, secondary text clears 4.5:1, muted clears AA on the lighter base.
const LIGHT: ThemeColors = {
  bg: '#F4F6F9',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  border: '#DFE3EA',
  textPrimary: '#14181F',
  textSecondary: '#4B5563',
  accent: '#2563EB',
  userBubble: '#2563EB',
  assistantBubble: '#EBEEF3',
  yellow: '#B45309',
  green: '#15803D',
  orange: '#C2410C',
  destructive: '#DC2626',
  mutedText: '#6B7280',
  codeBg: '#EEF2F7',
  codeBorder: '#CBD5E1',
};

export function getTheme(dark: boolean): ThemeColors {
  return dark ? DARK : LIGHT;
}

export function statusBarStyle(dark: boolean): 'light-content' | 'dark-content' {
  return dark ? 'light-content' : 'dark-content';
}
