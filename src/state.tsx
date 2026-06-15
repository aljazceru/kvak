/**
 * Mango × QVAC — App state management via React Context + useReducer.
 * All mutable state lives here instead of module-level variables.
 */
import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { NativeEventEmitter, NativeModules, Alert, Clipboard, Keyboard } from 'react-native';
import type { Conversation, Message, DeviceInfo, DownloadProgress, Screen, MCPServerConfig, MCPTool, UnifiedMCPServerConfig } from './types';
import { Llama, Speech, Whisper } from './services/native';
import { MODEL_CATALOG, WHISPER_CATALOG, TOOL_PROMPT, SYSTEM_PROMPT_DEFAULT } from './services/constants';
import { buildPrompt } from './services/templates';
import { processToolCalls, buildToolPrompt } from './services/tools';
import { mcpClient } from './services/mcp';
import { nostrMcpClient } from './services/nostr-mcp';
import type { NostrMCPServerConfig } from './services/nostr-mcp';
import { uid } from './services/helpers';
import {
  loadConversations, saveConversations,
  loadTheme, saveTheme,
  loadWhisperModelId, saveWhisperModelId,
  loadMCPServers, saveMCPServers,
  loadNostrMCPServers, saveNostrMCPServers,
} from './services/storage';

// ─── State shape ──────────────────────────────────────────────────────

interface AppState {
  screen: Screen;
  convs: Record<string, Conversation>;
  activeConvId: string | null;
  isDark: boolean;
  modelLoaded: boolean;
  loadedModelId: string;
  loadedTemplate: string;
  deviceInfo: DeviceInfo | null;
  downloadedFiles: Set<string>;
  activeDownloads: Map<string, DownloadProgress>;
  whisperLoaded: boolean;
  whisperModelId: string;
  ttsReady: boolean;
  renameId: string | null;
  renameText: string;
  // HTTP MCP
  mcpServers: MCPServerConfig[];
  mcpTools: MCPTool[];
  mcpConnecting: Set<string>;
  // Nostr MCP (ContextVM)
  nostrServers: UnifiedMCPServerConfig[];
  nostrTools: MCPTool[];
  nostrConnecting: Set<string>;
}

const initialState: AppState = {
  screen: 'conversations',
  convs: {},
  activeConvId: null,
  isDark: true,
  modelLoaded: false,
  loadedModelId: '',
  loadedTemplate: 'simple',
  deviceInfo: null,
  downloadedFiles: new Set(),
  activeDownloads: new Map(),
  whisperLoaded: false,
  whisperModelId: '',
  ttsReady: false,
  renameId: null,
  renameText: '',
  mcpServers: [],
  mcpTools: [],
  mcpConnecting: new Set(),
  nostrServers: [],
  nostrTools: [],
  nostrConnecting: new Set(),
};

// ─── Actions ──────────────────────────────────────────────────────────

type Action =
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'SET_CONVS'; convs: Record<string, Conversation> }
  | { type: 'ADD_CONV'; conv: Conversation }
  | { type: 'DELETE_CONV'; id: string }
  | { type: 'UPDATE_CONV'; id: string; patch: Partial<Conversation> }
  | { type: 'ADD_MESSAGE'; convId: string; message: Message }
  | { type: 'REMOVE_LAST_ASSISTANT'; convId: string }
  | { type: 'EDIT_MESSAGE'; convId: string; msgId: string; content: string }
  | { type: 'SET_ACTIVE_CONV'; id: string | null }
  | { type: 'SET_THEME'; dark: boolean }
  | { type: 'SET_MODEL_LOADED'; loaded: boolean; modelId: string; template: string }
  | { type: 'SET_DEVICE_INFO'; info: DeviceInfo }
  | { type: 'ADD_DOWNLOADED'; filename: string }
  | { type: 'REMOVE_DOWNLOADED'; filename: string }
  | { type: 'SET_DOWNLOAD_PROGRESS'; filename: string; progress: DownloadProgress }
  | { type: 'REMOVE_DOWNLOAD'; filename: string }
  | { type: 'SET_WHISPER'; loaded: boolean; modelId: string }
  | { type: 'SET_TTS_READY'; ready: boolean }
  | { type: 'SET_RENAME'; id: string | null; text: string }
  // HTTP MCP
  | { type: 'SET_MCP_SERVERS'; servers: MCPServerConfig[] }
  | { type: 'ADD_MCP_SERVER'; server: MCPServerConfig }
  | { type: 'REMOVE_MCP_SERVER'; id: string }
  | { type: 'UPDATE_MCP_SERVER'; id: string; patch: Partial<MCPServerConfig> }
  | { type: 'SET_MCP_TOOLS'; tools: MCPTool[] }
  | { type: 'SET_MCP_CONNECTING'; id: string; connecting: boolean }
  // Nostr MCP
  | { type: 'SET_NOSTR_SERVERS'; servers: UnifiedMCPServerConfig[] }
  | { type: 'ADD_NOSTR_SERVER'; server: UnifiedMCPServerConfig }
  | { type: 'REMOVE_NOSTR_SERVER'; id: string }
  | { type: 'UPDATE_NOSTR_SERVER'; id: string; patch: Partial<UnifiedMCPServerConfig> }
  | { type: 'SET_NOSTR_TOOLS'; tools: MCPTool[] }
  | { type: 'SET_NOSTR_CONNECTING'; id: string; connecting: boolean };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SCREEN':
      return { ...state, screen: action.screen };
    case 'SET_CONVS':
      return { ...state, convs: action.convs };
    case 'ADD_CONV':
      return { ...state, convs: { ...state.convs, [action.conv.id]: action.conv } };
    case 'DELETE_CONV': {
      const { [action.id]: _, ...rest } = state.convs;
      return {
        ...state,
        convs: rest,
        activeConvId: state.activeConvId === action.id ? null : state.activeConvId,
        screen: state.activeConvId === action.id ? 'conversations' : state.screen,
      };
    }
    case 'UPDATE_CONV':
      return {
        ...state,
        convs: {
          ...state.convs,
          [action.id]: {
            ...state.convs[action.id],
            ...action.patch,
            updatedAt: Date.now(),
          },
        },
      };
    case 'ADD_MESSAGE':
      return {
        ...state,
        convs: {
          ...state.convs,
          [action.convId]: {
            ...state.convs[action.convId],
            messages: [...state.convs[action.convId].messages, action.message],
            updatedAt: Date.now(),
          },
        },
      };
    case 'REMOVE_LAST_ASSISTANT': {
      const conv = state.convs[action.convId];
      if (!conv) return state;
      const msgs = [...conv.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') { msgs.splice(i, 1); break; }
      }
      return {
        ...state,
        convs: { ...state.convs, [action.convId]: { ...conv, messages: msgs, updatedAt: Date.now() } },
      };
    }
    case 'EDIT_MESSAGE': {
      const conv = state.convs[action.convId];
      if (!conv) return state;
      return {
        ...state,
        convs: {
          ...state.convs,
          [action.convId]: {
            ...conv,
            messages: conv.messages.map(m => m.id === action.msgId ? { ...m, content: action.content } : m),
            updatedAt: Date.now(),
          },
        },
      };
    }
    case 'SET_ACTIVE_CONV':
      return { ...state, activeConvId: action.id };
    case 'SET_THEME':
      return { ...state, isDark: action.dark };
    case 'SET_MODEL_LOADED':
      return { ...state, modelLoaded: action.loaded, loadedModelId: action.modelId, loadedTemplate: action.template };
    case 'SET_DEVICE_INFO':
      return { ...state, deviceInfo: action.info };
    case 'ADD_DOWNLOADED':
      return { ...state, downloadedFiles: new Set([...state.downloadedFiles, action.filename]) };
    case 'REMOVE_DOWNLOADED': {
      const next = new Set(state.downloadedFiles);
      next.delete(action.filename);
      return { ...state, downloadedFiles: next };
    }
    case 'SET_DOWNLOAD_PROGRESS': {
      const next = new Map(state.activeDownloads);
      next.set(action.filename, action.progress);
      return { ...state, activeDownloads: next };
    }
    case 'REMOVE_DOWNLOAD': {
      const next = new Map(state.activeDownloads);
      next.delete(action.filename);
      return { ...state, activeDownloads: next };
    }
    case 'SET_WHISPER':
      return { ...state, whisperLoaded: action.loaded, whisperModelId: action.modelId };
    case 'SET_TTS_READY':
      return { ...state, ttsReady: action.ready };
    case 'SET_RENAME':
      return { ...state, renameId: action.id, renameText: action.text };
    // HTTP MCP
    case 'SET_MCP_SERVERS':
      return { ...state, mcpServers: action.servers };
    case 'ADD_MCP_SERVER':
      return { ...state, mcpServers: [...state.mcpServers, action.server] };
    case 'REMOVE_MCP_SERVER':
      return { ...state, mcpServers: state.mcpServers.filter(s => s.id !== action.id), mcpTools: state.mcpTools.filter(t => t.serverId !== action.id) };
    case 'UPDATE_MCP_SERVER':
      return { ...state, mcpServers: state.mcpServers.map(s => s.id === action.id ? { ...s, ...action.patch } : s) };
    case 'SET_MCP_TOOLS':
      return { ...state, mcpTools: action.tools };
    case 'SET_MCP_CONNECTING': {
      const next = new Set(state.mcpConnecting);
      if (action.connecting) next.add(action.id); else next.delete(action.id);
      return { ...state, mcpConnecting: next };
    }
    // Nostr MCP
    case 'SET_NOSTR_SERVERS':
      return { ...state, nostrServers: action.servers };
    case 'ADD_NOSTR_SERVER':
      return { ...state, nostrServers: [...state.nostrServers, action.server] };
    case 'REMOVE_NOSTR_SERVER':
      return { ...state, nostrServers: state.nostrServers.filter(s => s.id !== action.id), nostrTools: state.nostrTools.filter(t => t.serverId !== action.id) };
    case 'UPDATE_NOSTR_SERVER':
      return { ...state, nostrServers: state.nostrServers.map(s => s.id === action.id ? { ...s, ...action.patch } : s) };
    case 'SET_NOSTR_TOOLS':
      return { ...state, nostrTools: action.tools };
    case 'SET_NOSTR_CONNECTING': {
      const next = new Set(state.nostrConnecting);
      if (action.connecting) next.add(action.id); else next.delete(action.id);
      return { ...state, nostrConnecting: next };
    }
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  openConversation: (id: string) => void;
  newConversation: () => void;
  deleteConversation: (id: string) => void;
  forkConversation: (id: string) => void;
  exportConversation: (id: string) => void;
  unloadModel: () => Promise<void>;
  modelPath: (filename: string) => string;
  forceRender: () => void;
  /** Connect to an HTTP MCP server */
  connectMCPServer: (config: MCPServerConfig) => Promise<void>;
  /** Disconnect from an HTTP MCP server */
  disconnectMCPServer: (id: string) => void;
  /** Connect to a Nostr MCP server */
  connectNostrServer: (config: UnifiedMCPServerConfig) => Promise<void>;
  /** Disconnect from a Nostr MCP server */
  disconnectNostrServer: (id: string) => void;
  /** Get the tool prompt including all MCP tools */
  getToolPrompt: () => string;
  /** Process tool calls (built-in + HTTP MCP + Nostr MCP) */
  executeToolCalls: (response: string, toolsEnabled: boolean) => Promise<{ cleaned: string; toolCalls: import('./types').ToolCall[] }>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────

const emitter = new NativeEventEmitter();

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const renderTick = useRef(0);
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

  // Model directory resolution
  const modelDirRef = useRef('/data/data/com.mangoqvac/files');
  function modelPath(filename: string) {
    return `${modelDirRef.current}/${filename}`;
  }

  // ─── Persistence ──────────────────────────────────────────────────

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const convsInitialized = useRef(false);

  useEffect(() => {
    if (!convsInitialized.current) {
      convsInitialized.current = true;
      return;
    }
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      saveConversations(state.convs).catch(() => {});
    }, 500);
    return () => { if (persistTimer.current) clearTimeout(persistTimer.current); };
  }, [state.convs]);

  const themeInitialized = useRef(false);
  useEffect(() => {
    if (!themeInitialized.current) {
      themeInitialized.current = true;
      return;
    }
    saveTheme(state.isDark);
  }, [state.isDark]);

  const mcpInitialized = useRef(false);
  useEffect(() => {
    if (!mcpInitialized.current) { mcpInitialized.current = true; return; }
    saveMCPServers(state.mcpServers);
  }, [state.mcpServers]);

  const nostrInitialized = useRef(false);
  useEffect(() => {
    if (!nostrInitialized.current) { nostrInitialized.current = true; return; }
    saveNostrMCPServers(state.nostrServers);
  }, [state.nostrServers]);

  // ─── Actions ──────────────────────────────────────────────────────

  function openConversation(id: string) {
    dispatch({ type: 'SET_ACTIVE_CONV', id });
    dispatch({ type: 'SET_SCREEN', screen: 'chat' });
  }

  function newConversation() {
    const id = `c_${uid()}`;
    const conv: Conversation = {
      id, title: 'New Conversation', messages: [], toolsEnabled: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    dispatch({ type: 'ADD_CONV', conv });
    dispatch({ type: 'SET_ACTIVE_CONV', id });
    dispatch({ type: 'SET_SCREEN', screen: 'chat' });
  }

  function deleteConversation(id: string) {
    dispatch({ type: 'DELETE_CONV', id });
  }

  function forkConversation(id: string) {
    const src = state.convs[id];
    if (!src) return;
    const nid = `c_${uid()}`;
    const forked: Conversation = {
      ...src,
      id: nid,
      title: `${src.title} (copy)`,
      messages: src.messages.map(m => ({ ...m })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch({ type: 'ADD_CONV', conv: forked });
    dispatch({ type: 'SET_ACTIVE_CONV', id: nid });
    dispatch({ type: 'SET_SCREEN', screen: 'chat' });
  }

  function exportConversation(id: string) {
    const conv = state.convs[id];
    if (!conv) return;
    let md = `# ${conv.title}\n\n`;
    conv.messages.forEach(m => {
      md += `## ${m.role === 'user' ? 'You' : 'Assistant'}\n\n${m.content}\n\n`;
    });
    Clipboard.setString(md);
    Alert.alert('Exported', 'Chat copied to clipboard as Markdown.');
  }

  async function unloadModel() {
    await Llama?.free();
    dispatch({ type: 'SET_MODEL_LOADED', loaded: false, modelId: '', template: '' });
  }

  function forceRender() {
    forceUpdate();
  }

  // ─── HTTP MCP Actions ──────────────────────────────────────────────

  async function connectMCPServer(config: MCPServerConfig) {
    dispatch({ type: 'SET_MCP_CONNECTING', id: config.id, connecting: true });
    try {
      const conn = await mcpClient.connect(config);
      if (conn.connected) {
        dispatch({ type: 'UPDATE_MCP_SERVER', id: config.id, patch: { enabled: true } });
      } else {
        dispatch({ type: 'UPDATE_MCP_SERVER', id: config.id, patch: { enabled: false } });
        if (conn.error) Alert.alert('MCP Connection Failed', conn.error);
      }
    } catch (e: any) {
      dispatch({ type: 'UPDATE_MCP_SERVER', id: config.id, patch: { enabled: false } });
      Alert.alert('MCP Error', e.message || String(e));
    }
    dispatch({ type: 'SET_MCP_CONNECTING', id: config.id, connecting: false });
    refreshMCPTools();
  }

  function disconnectMCPServer(id: string) {
    mcpClient.disconnect(id);
    dispatch({ type: 'UPDATE_MCP_SERVER', id, patch: { enabled: false } });
    refreshMCPTools();
  }

  function refreshMCPTools() {
    dispatch({ type: 'SET_MCP_TOOLS', tools: mcpClient.getAllTools() });
  }

  // ─── Nostr MCP Actions (ContextVM) ─────────────────────────────────

  async function connectNostrServer(config: UnifiedMCPServerConfig) {
    if (!config.serverPubkey || !config.relayUrls?.length) {
      Alert.alert('Invalid Config', 'Nostr MCP server requires a pubkey and at least one relay URL.');
      return;
    }

    dispatch({ type: 'SET_NOSTR_CONNECTING', id: config.id, connecting: true });
    try {
      const nostrConfig: NostrMCPServerConfig = {
        id: config.id,
        name: config.name,
        serverPubkey: config.serverPubkey,
        relayUrls: config.relayUrls,
        enabled: false,
      };

      const conn = await nostrMcpClient.connect(nostrConfig);
      if (conn.connected) {
        dispatch({ type: 'UPDATE_NOSTR_SERVER', id: config.id, patch: { enabled: true } });
      } else {
        dispatch({ type: 'UPDATE_NOSTR_SERVER', id: config.id, patch: { enabled: false } });
        if (conn.error) Alert.alert('Nostr MCP Connection Failed', conn.error);
      }
    } catch (e: any) {
      dispatch({ type: 'UPDATE_NOSTR_SERVER', id: config.id, patch: { enabled: false } });
      Alert.alert('Nostr MCP Error', e.message || String(e));
    }
    dispatch({ type: 'SET_NOSTR_CONNECTING', id: config.id, connecting: false });
    refreshNostrTools();
  }

  function disconnectNostrServer(id: string) {
    nostrMcpClient.disconnect(id);
    dispatch({ type: 'UPDATE_NOSTR_SERVER', id, patch: { enabled: false } });
    refreshNostrTools();
  }

  function refreshNostrTools() {
    dispatch({ type: 'SET_NOSTR_TOOLS', tools: nostrMcpClient.getAllTools() });
  }

  // ─── Unified Tool Access ──────────────────────────────────────────

  function getToolPrompt(): string {
    const allTools = [
      ...state.mcpTools,
      ...state.nostrTools,
    ];
    return buildToolPrompt(allTools);
  }

  async function executeToolCalls(response: string, toolsEnabled: boolean) {
    // Convert unified nostr servers to the format expected by processToolCalls
    const nostrConfigs: NostrMCPServerConfig[] = state.nostrServers.map(s => ({
      id: s.id,
      name: s.name,
      serverPubkey: s.serverPubkey || '',
      relayUrls: s.relayUrls || [],
      enabled: s.enabled,
    }));
    return processToolCalls(response, toolsEnabled, state.mcpServers, nostrConfigs);
  }

  // ─── Init ─────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Load persisted state
      const [persistedConvs, persistedTheme, persistedWhisper, persistedMCPServers, persistedNostrServers] = await Promise.all([
        loadConversations(),
        loadTheme(),
        loadWhisperModelId(),
        loadMCPServers(),
        loadNostrMCPServers(),
      ]);

      if (cancelled) return;

      dispatch({ type: 'SET_CONVS', convs: persistedConvs });
      dispatch({ type: 'SET_THEME', dark: persistedTheme });

      // Restore HTTP MCP servers
      if (persistedMCPServers.length > 0) {
        dispatch({ type: 'SET_MCP_SERVERS', servers: persistedMCPServers });
        for (const server of persistedMCPServers) {
          if (server.enabled) {
            mcpClient.connect(server).then(conn => {
              if (conn.connected) refreshMCPTools();
            }).catch(() => {});
          }
        }
      }

      // Restore Nostr MCP servers
      if (persistedNostrServers.length > 0) {
        dispatch({ type: 'SET_NOSTR_SERVERS', servers: persistedNostrServers });
        for (const server of persistedNostrServers) {
          if (server.enabled) {
            connectNostrServer(server).catch(() => {});
          }
        }
      }

      if (Llama) {
        try {
          const info = await Llama.getDeviceInfo();
          dispatch({ type: 'SET_DEVICE_INFO', info });

          try { modelDirRef.current = await Llama.modelDir(); } catch {}

          const files: string[] = await Llama.listModels();
          files.forEach(f => dispatch({ type: 'ADD_DOWNLOADED', filename: f }));

          for (const wm of [...WHISPER_CATALOG].reverse()) {
            const exists = await Llama.fileExists(modelPath(wm.filename));
            if (exists) {
              dispatch({ type: 'ADD_DOWNLOADED', filename: wm.filename });
              if (Whisper && !cancelled) {
                const ok = await Whisper.loadModel(modelPath(wm.filename));
                if (ok) {
                  dispatch({ type: 'SET_WHISPER', loaded: true, modelId: wm.id });
                  saveWhisperModelId(wm.id);
                }
              }
            }
          }

          if (Speech) {
            try {
              const ready = await Speech.isTTSReady();
              dispatch({ type: 'SET_TTS_READY', ready });
            } catch {}

            const pollTTS = async () => {
              for (let i = 0; i < 10; i++) {
                await new Promise<void>(r => setTimeout(r, 1500));
                if (cancelled) return;
                try {
                  const ready = await Speech!.isTTSReady();
                  if (ready) {
                    dispatch({ type: 'SET_TTS_READY', ready: true });
                    return;
                  }
                } catch {}
              }
            };
            pollTTS();
          }
        } catch (e) {
          console.warn('Init error:', e);
        }
      }
    })();

    const sub1 = emitter.addListener('downloadProgress', (e: any) => {
      dispatch({
        type: 'SET_DOWNLOAD_PROGRESS',
        filename: e.filename,
        progress: { pct: e.pct, downloaded: e.downloaded, total: e.total },
      });
    });
    const sub2 = emitter.addListener('downloadComplete', (e: any) => {
      if (e.success) {
        dispatch({ type: 'ADD_DOWNLOADED', filename: e.filename });
        const wm = WHISPER_CATALOG.find(m => m.filename === e.filename);
        if (wm && Whisper) {
          Whisper.loadModel(modelPath(wm.filename)).then(ok => {
            if (ok) {
              dispatch({ type: 'SET_WHISPER', loaded: true, modelId: wm.id });
              saveWhisperModelId(wm.id);
            }
          });
        }
      }
      dispatch({ type: 'REMOVE_DOWNLOAD', filename: e.filename });
    });

    return () => {
      cancelled = true;
      sub1.remove();
      sub2.remove();
    };
  }, []);

  // ─── Render ───────────────────────────────────────────────────────

  const value: AppContextValue = {
    state, dispatch,
    openConversation, newConversation, deleteConversation,
    forkConversation, exportConversation, unloadModel,
    modelPath, forceRender,
    connectMCPServer, disconnectMCPServer,
    connectNostrServer, disconnectNostrServer,
    getToolPrompt, executeToolCalls,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
