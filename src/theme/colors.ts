/**
 * Mango × QVAC — Theme system
 * Memoized color palette for dark/light modes.
 */
import { Platform, StatusBar as RNStatusBar } from 'react-native';

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
  bg: '#1A1A1A',
  surface: '#222222',
  card: '#2A2A2A',
  border: '#333333',
  textPrimary: '#F5F5F5',
  textSecondary: '#999999',
  accent: '#4D9EFF',
  userBubble: '#2E4A7A',
  assistantBubble: '#262626',
  yellow: '#FBB824',
  green: '#4ADE80',
  orange: '#FB923C',
  destructive: '#F87171',
  mutedText: '#777777',
  codeBg: '#1E1E2E',
  codeBorder: '#444444',
};

const LIGHT: ThemeColors = {
  bg: '#F8F9FA',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  border: '#E5E7EB',
  textPrimary: '#1F2937',
  textSecondary: '#6B7280',
  accent: '#3B82F6',
  userBubble: '#DBEAFE',
  assistantBubble: '#F3F4F6',
  yellow: '#F59E0B',
  green: '#22C55E',
  orange: '#F97316',
  destructive: '#EF4444',
  mutedText: '#9CA3AF',
  codeBg: '#F1F5F9',
  codeBorder: '#CBD5E1',
};

const THEME_CACHE = { dark: DARK, light: LIGHT };

export function getTheme(dark: boolean): ThemeColors {
  return dark ? THEME_CACHE.dark : THEME_CACHE.light;
}

export function statusBarStyle(dark: boolean): 'light-content' | 'dark-content' {
  return dark ? 'light-content' : 'dark-content';
}
