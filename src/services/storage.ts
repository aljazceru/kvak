/**
 * Mango × QVAC — AsyncStorage persistence layer
 * Saves/loads conversations, settings, and model preferences.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Conversation, MCPServerConfig, UnifiedMCPServerConfig } from '../types';

const KEYS = {
  conversations: '@mangoqvac:conversations',
  theme: '@mangoqvac:theme',
  whisperModel: '@mangoqvac:whisperModel',
  mcpServers: '@mangoqvac:mcpServers',
  nostrMcpServers: '@mangoqvac:nostrMcpServers',
};

/**
 * Load all persisted conversations.
 * Includes a one-time migration: clear stale '(empty)' placeholder content
 * that earlier versions wrote for tool-call-only assistant messages.
 */
export async function loadConversations(): Promise<Record<string, Conversation>> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.conversations);
    if (raw) {
      const convs = JSON.parse(raw) as Record<string, Conversation>;
      for (const id of Object.keys(convs)) {
        const conv = convs[id];
        if (!conv?.messages) continue;
        let changed = false;
        conv.messages = conv.messages.map((m: any) => {
          if (m && m.content === '(empty)') { changed = true; return { ...m, content: '' }; }
          return m;
        });
        if (changed) convs[id] = conv;
      }
      return convs;
    }
  } catch (e) {
    console.warn('Failed to load conversations:', e);
  }
  return {};
}

/**
 * Save all conversations to storage.
 */
export async function saveConversations(convs: Record<string, Conversation>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.conversations, JSON.stringify(convs));
  } catch (e) {
    console.warn('Failed to save conversations:', e);
  }
}

/**
 * Load theme preference.
 */
export async function loadTheme(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(KEYS.theme);
    return val === 'light' ? false : true; // default dark
  } catch { return true; }
}

/**
 * Save theme preference.
 */
export async function saveTheme(dark: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.theme, dark ? 'dark' : 'light');
  } catch {}
}

/**
 * Load preferred whisper model ID.
 */
export async function loadWhisperModelId(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEYS.whisperModel)) || '';
  } catch { return ''; }
}

/**
 * Save preferred whisper model ID.
 */
export async function saveWhisperModelId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.whisperModel, id);
  } catch {}
}

// ─── MCP Servers ────────────────────────────────────────────────

export async function loadMCPServers(): Promise<MCPServerConfig[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.mcpServers);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export async function saveMCPServers(servers: MCPServerConfig[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.mcpServers, JSON.stringify(servers));
  } catch {}
}

// ─── Nostr MCP Servers ──────────────────────────────────────────

export async function loadNostrMCPServers(): Promise<UnifiedMCPServerConfig[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.nostrMcpServers);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export async function saveNostrMCPServers(servers: UnifiedMCPServerConfig[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.nostrMcpServers, JSON.stringify(servers));
  } catch {}
}
