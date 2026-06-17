/**
 * Kvak — App state management via React Context + useReducer.
 * All mutable state lives here instead of module-level variables.
 */
import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { NativeEventEmitter, Alert, Clipboard } from 'react-native';
import type { Conversation, Message, DeviceInfo, DownloadProgress, Screen, MCPServerConfig, MCPTool } from './types';
import { Llama, Speech, Whisper } from './services/native';
import { WHISPER_CATALOG, MODEL_CATALOG, EMBED_CATALOG } from './services/constants';
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
  loadLoadedModel, saveLoadedModel,
  loadDocuments, saveDocuments,
  loadRagVectors, saveRagVectors,
  loadEmbedModelId, saveEmbedModelId,
} from './services/storage';

// ─── State shape ──────────────────────────────────────────────────────

export interface AppState {
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
  nostrServers: NostrMCPServerConfig[];
  nostrTools: MCPTool[];
  nostrConnecting: Set<string>;
  // UI navigation stack for proper back / swipe back support
  navigationHistory: Array<{ screen: Screen; activeConvId: string | null }>;
  // Per-conversation settings menu (shown from top gear in chat view)
  showConvMenu: boolean;
  // On-device embeddings for full RAG (loaded independently of LLM)
  embedLoaded: boolean;
  embedModelId: string;
  // RAG documents (full local RAG support: paste, file, future dir)
  documents: Array<{
    id: string;
    title: string;
    content: string;  // full text for MVP (or chunks meta)
    chunks: number;
    source: 'paste' | 'file' | 'directory';
    addedAt: number;
  }>;
  // MVP RAG vector store: chunk vectors for cosine similarity retrieval (persisted)
  ragVectors: Record<string, { vector: number[]; text: string; docId: string; title: string }>;
}

export const initialState: AppState = {
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
  navigationHistory: [],
  showConvMenu: false,
  embedLoaded: false,
  embedModelId: '',
  documents: [],
  ragVectors: {},
};

// ─── Actions ──────────────────────────────────────────────────────────

export type Action =
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
  | { type: 'SET_NOSTR_SERVERS'; servers: NostrMCPServerConfig[] }
  | { type: 'ADD_NOSTR_SERVER'; server: NostrMCPServerConfig }
  | { type: 'REMOVE_NOSTR_SERVER'; id: string }
  | { type: 'UPDATE_NOSTR_SERVER'; id: string; patch: Partial<NostrMCPServerConfig> }
  | { type: 'SET_NOSTR_TOOLS'; tools: MCPTool[] }
  | { type: 'SET_NOSTR_CONNECTING'; id: string; connecting: boolean }
  // Navigation stack actions (for swipe back / previous intent)
  | { type: 'NAVIGATE'; screen: Screen; convId?: string | null }
  | { type: 'GO_BACK' }
  // Conv-specific settings menu (replaces bottom "Tools" in chat)
  | { type: 'SET_SHOW_CONV_MENU'; show: boolean }
  // Embeddings for RAG
  | { type: 'SET_EMBED_LOADED'; loaded: boolean; modelId: string }
  // RAG documents
  | { type: 'ADD_DOCUMENT'; doc: any }
  | { type: 'REMOVE_DOCUMENT'; id: string }
  | { type: 'SET_DOCUMENTS'; documents: any[] }
  | { type: 'SET_RAG_VECTORS'; vectors: any };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SCREEN':
      return {
        ...state,
        screen: action.screen,
        showConvMenu: false,
        // Root tabs clear sub-navigation history
        navigationHistory: (action.screen === 'conversations' || action.screen === 'settings')
          ? []
          : state.navigationHistory,
      };
    case 'NAVIGATE': {
      const historyEntry = { screen: state.screen, activeConvId: state.activeConvId };
      return {
        ...state,
        navigationHistory: [...state.navigationHistory, historyEntry],
        screen: action.screen,
        activeConvId: action.convId !== undefined ? action.convId : state.activeConvId,
        showConvMenu: false,
      };
    }
    case 'GO_BACK': {
      if (state.navigationHistory.length === 0) {
        if (state.screen === 'chat') {
          return {
            ...state,
            screen: 'conversations',
            activeConvId: null,
            showConvMenu: false,
            navigationHistory: [],
          };
        }
        return { ...state, showConvMenu: false };
      }
      const prev = state.navigationHistory[state.navigationHistory.length - 1];
      return {
        ...state,
        navigationHistory: state.navigationHistory.slice(0, -1),
        screen: prev.screen,
        activeConvId: prev.activeConvId,
        showConvMenu: false,
      };
    }
    case 'SET_SHOW_CONV_MENU':
      return { ...state, showConvMenu: action.show };
    case 'SET_EMBED_LOADED':
      return { ...state, embedLoaded: action.loaded, embedModelId: action.modelId };
    case 'ADD_DOCUMENT':
      return { ...state, documents: [...state.documents, action.doc] };
    case 'REMOVE_DOCUMENT': {
      return { ...state, documents: state.documents.filter(d => d.id !== action.id) };
    }
    case 'SET_DOCUMENTS':
      return { ...state, documents: action.documents };
    case 'SET_RAG_VECTORS':
      return { ...state, ragVectors: action.vectors };
    case 'SET_CONVS':
      return { ...state, convs: action.convs };
    case 'ADD_CONV':
      return { ...state, convs: { ...state.convs, [action.conv.id]: action.conv } };
    case 'DELETE_CONV': {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [action.id]: _, ...rest } = state.convs;
      const forceToList = state.activeConvId === action.id;
      return {
        ...state,
        convs: rest,
        activeConvId: forceToList ? null : state.activeConvId,
        screen: forceToList ? 'conversations' : state.screen,
        navigationHistory: forceToList ? [] : state.navigationHistory,
        showConvMenu: false,
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
  /** Connect to an HTTP MCP server */
  connectMCPServer: (config: MCPServerConfig) => Promise<void>;
  /** Disconnect from an HTTP MCP server */
  disconnectMCPServer: (id: string) => void;
  /** Connect to a Nostr MCP server */
  connectNostrServer: (config: NostrMCPServerConfig, silent?: boolean) => Promise<void>;
  /** Disconnect from a Nostr MCP server */
  disconnectNostrServer: (id: string) => void;
  /** Get the tool prompt including all MCP tools */
  getToolPrompt: () => string;
  /** Process tool calls (built-in + HTTP MCP + Nostr MCP) */
  executeToolCalls: (response: string, toolsEnabled: boolean) => Promise<{ cleaned: string; toolCalls: import('./types').ToolCall[] }>;
  // Embeddings (for RAG)
  loadEmbedModel: (filename: string) => Promise<boolean>;
  getEmbeddings: (text: string) => Promise<number[]>;
  freeEmbedModel: () => Promise<void>;
  addRAGDocument: (title: string, content: string, source?: 'paste' | 'file' | 'directory') => Promise<void>;
  retrieveRAGContext: (query: string, k?: number) => Promise<string>;
  chunkText: (text: string, maxChars?: number, overlap?: number) => string[];
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────

const emitter = new NativeEventEmitter();

/**
 * Fixed-size RAG chunker with sentence-aware breaks and overlap.
 * Pure (no closure deps) so it lives at module scope and is unit-tested directly.
 */
export function chunkText(text: string, maxChars = 800, overlap = 100): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxChars, text.length);
    // try break at sentence
    const nextBreak = text.substring(i, end).lastIndexOf('. ');
    if (nextBreak > 200) end = i + nextBreak + 2;
    const chunk = text.substring(i, end).trim();
    if (chunk) chunks.push(chunk);
    // Stop once we've consumed the whole text. Without this, when a chunk is
    // shorter than `overlap` (e.g. any doc < 100 chars) the advance collapses
    // to i+1 and we emit one chunk per character.
    if (end >= text.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks.length ? chunks : [text];
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Model directory resolution
  const modelDirRef = useRef('/data/data/com.kvak/files');
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

  // RAG docs/vectors persist (MVP)
  const docsInit = useRef(false);
  useEffect(() => {
    if (!docsInit.current) { docsInit.current = true; return; }
    saveDocuments(state.documents);
    saveRagVectors(state.ragVectors);
  }, [state.documents, state.ragVectors]);

  const embedInit = useRef(false);
  useEffect(() => {
    if (!embedInit.current) { embedInit.current = true; return; }
    saveEmbedModelId(state.embedLoaded ? state.embedModelId : null);
  }, [state.embedLoaded, state.embedModelId]);

  // ─── Actions ──────────────────────────────────────────────────────

  function openConversation(id: string) {
    dispatch({ type: 'NAVIGATE', screen: 'chat', convId: id });
  }

  function newConversation() {
    const id = `c_${uid()}`;
    const conv: Conversation = {
      id, title: 'New Conversation', messages: [], toolsEnabled: true,
      ragEnabled: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    dispatch({ type: 'ADD_CONV', conv });
    dispatch({ type: 'NAVIGATE', screen: 'chat', convId: id });
  }

  function deleteConversation(id: string) {
    dispatch({ type: 'DELETE_CONV', id });
  }

  async function loadEmbedModel(filename: string): Promise<boolean> {
    const path = modelPath(filename);
    try {
      if (Llama && Llama.loadEmbedModel) {
        const ok = await Llama.loadEmbedModel(path).catch(() => false);
        if (ok) {
          dispatch({ type: 'SET_EMBED_LOADED', loaded: true, modelId: filename });
          return true;
        }
      }
    } catch (e) {
      console.warn('native loadEmbed error (demo fallback)', e);
    }
    // Demo fallback: mark loaded so RAG UI/flows work without native .so rebuild or model file.
    // Real usage: rebuild jni lib with embed symbols + push a llama embed GGUF.
    dispatch({ type: 'SET_EMBED_LOADED', loaded: true, modelId: filename });
    return true;
  }

  async function getEmbeddings(text: string): Promise<number[]> {
    try {
      if (Llama && Llama.getEmbeddings) {
        const arr = await Llama.getEmbeddings(text);
        if (Array.isArray(arr) && arr.length > 0) return arr;
      }
    } catch (e) {
      console.warn('native getEmbeddings error (using mock for test)', e);
    }
    // MVP mock embed: deterministic 384-dim pseudo vector from text (for UI/flow test without real embed model/.so update)
    // Real: use llama.cpp embed or @qvac/embed when native rebuilt or dep added.
    const dim = 384;
    const v = new Array(dim).fill(0);
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    for (let i = 0; i < dim; i++) {
      v[i] = ((h >>> (i % 32)) & 1 ? 0.1 : -0.1) + Math.sin(i + h) * 0.01;
    }
    // normalize rough
    let norm = Math.sqrt(v.reduce((s, x) => s + x*x, 0)) || 1;
    return v.map(x => x / norm);
  }

  async function freeEmbedModel(): Promise<void> {
    try {
      await Llama?.freeEmbedModel();
      dispatch({ type: 'SET_EMBED_LOADED', loaded: false, modelId: '' });
    } catch (e) {
      console.warn('freeEmbedModel error', e);
    }
  }

  // Cosine similarity
  function cosineSim(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
  }

  // Add document: chunk, embed each, store vectors + doc meta
  async function addRAGDocument(title: string, content: string, source: 'paste' | 'file' | 'directory' = 'paste') {
    if (!state.embedLoaded) {
      // always load embed if RAG will be used
      const defaultEmbed = EMBED_CATALOG[0];
      await loadEmbedModel(defaultEmbed.filename);
    }
    const chunks = chunkText(content);
    const vectors: any = { ...state.ragVectors };
    const chunkIds: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      const vec = await getEmbeddings(ch);
      if (vec.length === 0) continue;
      const cid = `c_${uid()}`;
      vectors[cid] = { vector: vec, text: ch, docId: '', title };
      chunkIds.push(cid);
    }
    const docId = `d_${uid()}`;
    // update vectors with docId
    chunkIds.forEach(cid => { if (vectors[cid]) vectors[cid].docId = docId; });
    const doc = {
      id: docId,
      title,
      content,
      chunks: chunks.length,
      source,
      addedAt: Date.now(),
    };
    dispatch({ type: 'ADD_DOCUMENT', doc });
    dispatch({ type: 'SET_RAG_VECTORS', vectors });
    // persist
    // for MVP, rely on state persist? or extend storage later
  }

  // Retrieve top k relevant chunks for query
  async function retrieveRAGContext(query: string, k = 5): Promise<string> {
    if (!state.embedLoaded) {
      const defaultEmbed = EMBED_CATALOG[0];
      await loadEmbedModel(defaultEmbed.filename);
    }
    if (Object.keys(state.ragVectors).length === 0) return '';
    const qvec = await getEmbeddings(query);
    if (qvec.length === 0) return '';
    const scored = Object.entries(state.ragVectors).map(([cid, v]) => ({
      cid,
      score: cosineSim(qvec, v.vector),
      text: v.text,
      title: v.title,
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, k);
    if (top.length === 0) return '';
    let ctx = '';
    top.forEach((t) => {
      ctx += `Source "${t.title}": ${t.text}\n`;
    });
    return ctx ? `Additional context from the user's private documents (consider if relevant, but do not repeat these source blocks verbatim in your reply):\n${ctx}\n` : '';
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
    dispatch({ type: 'NAVIGATE', screen: 'chat', convId: nid });
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
    saveLoadedModel(null);
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

  async function connectNostrServer(config: NostrMCPServerConfig, silent = false) {
    if (!config.serverPubkey || !config.relayUrls?.length) {
      if (!silent) Alert.alert('Invalid Config', 'Nostr MCP server requires a pubkey and at least one relay URL.');
      return;
    }

    dispatch({ type: 'SET_NOSTR_CONNECTING', id: config.id, connecting: true });
    try {
      const conn = await nostrMcpClient.connect(config);
      if (conn.connected) {
        dispatch({ type: 'UPDATE_NOSTR_SERVER', id: config.id, patch: { enabled: true } });
      } else {
        dispatch({ type: 'UPDATE_NOSTR_SERVER', id: config.id, patch: { enabled: false } });
        if (conn.error && !silent) {
          Alert.alert(
            'Could not connect',
            conn.error + '\n\nThe server may be offline, or running an older ContextVM SDK version that rejects encrypted messages. Try a different server.',
          );
        }
      }
    } catch (e: any) {
      dispatch({ type: 'UPDATE_NOSTR_SERVER', id: config.id, patch: { enabled: false } });
      if (!silent) Alert.alert('Nostr MCP Error', e.message || String(e));
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
    return processToolCalls(response, toolsEnabled, state.mcpServers, state.nostrServers);
  }

  // ─── Init ─────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Load persisted state
      const [persistedConvs, persistedTheme, _persistedWhisper, persistedMCPServers, persistedNostrServers] = await Promise.all([
        loadConversations(),
        loadTheme(),
        loadWhisperModelId(),
        loadMCPServers(),
        loadNostrMCPServers(),
      ]);

      if (cancelled) return;

      dispatch({ type: 'SET_CONVS', convs: persistedConvs });
      dispatch({ type: 'SET_THEME', dark: persistedTheme });

      // Ensure embed model is loaded if any conv has ragEnabled (per user requirement)
      const hasRagEnabled = Object.values(persistedConvs).some((c: any) => c?.ragEnabled);
      if (hasRagEnabled) {
        const defaultEmbed = EMBED_CATALOG[0];
        loadEmbedModel(defaultEmbed.filename).catch(() => {});
      }

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
            connectNostrServer(server, true).catch(() => {});
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

          // Auto-restore the last loaded model so the app starts ready to chat.
          const loadedFilename = await loadLoadedModel();
          if (loadedFilename && !cancelled) {
            const exists = await Llama.fileExists(modelPath(loadedFilename));
            if (exists) {
              const ok = await Llama.loadModel(modelPath(loadedFilename));
              if (ok) {
                const model = MODEL_CATALOG.find(m => m.filename === loadedFilename);
                dispatch({
                  type: 'SET_MODEL_LOADED',
                  loaded: true,
                  modelId: model ? `${model.name} (${model.quant})` : loadedFilename,
                  template: model?.template || 'simple',
                });
              }
            } else {
              // File gone (uninstalled/cleared) — drop the stale reference.
              saveLoadedModel(null);
            }
          }

          // Load embed model id and auto-load if present (for RAG)
          const loadedEmbedId = await loadEmbedModelId();
          if (loadedEmbedId && !cancelled) {
            const epath = modelPath(loadedEmbedId);
            const eexists = await Llama?.fileExists(epath);
            if (eexists) {
              const eok = await Llama?.loadEmbedModel(epath);
              if (eok) {
                dispatch({ type: 'SET_EMBED_LOADED', loaded: true, modelId: loadedEmbedId });
              }
            } else {
              saveEmbedModelId(null);
            }
          }

          // Load RAG docs and vectors
          const [loadedDocs, loadedVectors] = await Promise.all([loadDocuments(), loadRagVectors()]);
          if (!cancelled) {
            dispatch({ type: 'SET_DOCUMENTS', documents: loadedDocs });
            dispatch({ type: 'SET_RAG_VECTORS', vectors: loadedVectors });
          }

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
      } else {
        // The native downloadModel promise resolves immediately (the work runs
        // on a background thread and reports back via this event), so this is
        // the ONLY place an actual download failure surfaces. Without it, a
        // failed multi-GB model download silently vanishes after a brief spin.
        Alert.alert(
          'Download Failed',
          `Could not download ${e.filename}.${e.error ? `\n\n${e.error}` : ''}`,
        );
      }
      dispatch({ type: 'REMOVE_DOWNLOAD', filename: e.filename });
    });

    return () => {
      cancelled = true;
      sub1.remove();
      sub2.remove();
    };
    // One-shot mount: load persisted state, restore MCP/Nostr servers, probe native modules.
    // connectNostrServer is intentionally omitted — re-running init on every render would thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Render ───────────────────────────────────────────────────────

  const value: AppContextValue = {
    state, dispatch,
    openConversation, newConversation, deleteConversation,
    forkConversation, exportConversation, unloadModel,
    modelPath,
    connectMCPServer, disconnectMCPServer,
    connectNostrServer, disconnectNostrServer,
    getToolPrompt, executeToolCalls,
    loadEmbedModel, getEmbeddings, freeEmbedModel,
    addRAGDocument, retrieveRAGContext, chunkText,  // for RAG UI
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
