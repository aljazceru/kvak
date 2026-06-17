/**
 * Reducer unit tests — conversation CRUD, messaging, navigation stack, and
 * MCP state. The reducer is pure; importing state.tsx is safe under jest once
 * NativeEventEmitter/AsyncStorage are mocked (see jest.setup.js).
 */
import { reducer, initialState, type Action } from '../src/state';
import type { Conversation } from '../src/types';

const conv = (id: string): Conversation => ({
  id,
  title: `T-${id}`,
  messages: [],
  toolsEnabled: false,
  createdAt: 1,
  updatedAt: 1,
});

function apply(state: typeof initialState, ...actions: Action[]) {
  return actions.reduce(reducer, state);
}

describe('conversations', () => {
  it('ADD_CONV inserts into the map', () => {
    const s = reducer(initialState, { type: 'ADD_CONV', conv: conv('a') });
    expect(s.convs.a).toBeDefined();
    expect(Object.keys(s.convs)).toHaveLength(1);
  });

  it('ADD_MESSAGE appends and bumps updatedAt', () => {
    const before = Date.now();
    const s = apply(
      initialState,
      { type: 'ADD_CONV', conv: conv('a') },
      { type: 'ADD_MESSAGE', convId: 'a', message: { id: 'm1', role: 'user', content: 'hi' } },
    );
    expect(s.convs.a.messages).toHaveLength(1);
    expect(s.convs.a.messages[0].content).toBe('hi');
    expect(s.convs.a.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('UPDATE_CONV merges the patch', () => {
    const s = apply(
      initialState,
      { type: 'ADD_CONV', conv: conv('a') },
      { type: 'UPDATE_CONV', id: 'a', patch: { title: 'renamed', toolsEnabled: true } },
    );
    expect(s.convs.a.title).toBe('renamed');
    expect(s.convs.a.toolsEnabled).toBe(true);
  });

  it('REMOVE_LAST_ASSISTANT only strips the final assistant turn', () => {
    const s = apply(
      initialState,
      { type: 'ADD_CONV', conv: conv('a') },
      { type: 'ADD_MESSAGE', convId: 'a', message: { id: 'u1', role: 'user', content: '?' } },
      { type: 'ADD_MESSAGE', convId: 'a', message: { id: 'a1', role: 'assistant', content: 'old' } },
      { type: 'ADD_MESSAGE', convId: 'a', message: { id: 'u2', role: 'user', content: 'again' } },
      { type: 'ADD_MESSAGE', convId: 'a', message: { id: 'a2', role: 'assistant', content: 'new' } },
      { type: 'REMOVE_LAST_ASSISTANT', convId: 'a' },
    );
    expect(s.convs.a.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2']);
  });

  it('DELETE_CONV of an inactive conv leaves the active one intact', () => {
    const s = apply(
      initialState,
      { type: 'ADD_CONV', conv: conv('a') },
      { type: 'ADD_CONV', conv: conv('b') },
      { type: 'SET_ACTIVE_CONV', id: 'a' },
      { type: 'DELETE_CONV', id: 'b' },
    );
    expect(s.convs.b).toBeUndefined();
    expect(s.convs.a).toBeDefined();
    expect(s.activeConvId).toBe('a');
  });

  it('DELETE_CONV of the ACTIVE conv resets to the list screen', () => {
    const s = apply(
      initialState,
      { type: 'ADD_CONV', conv: conv('a') },
      { type: 'NAVIGATE', screen: 'chat', convId: 'a' },
      { type: 'DELETE_CONV', id: 'a' },
    );
    expect(s.convs.a).toBeUndefined();
    expect(s.activeConvId).toBeNull();
    expect(s.screen).toBe('conversations');
    expect(s.navigationHistory).toEqual([]);
  });
});

describe('navigation stack', () => {
  it('NAVIGATE pushes current screen and switches', () => {
    const s = apply(
      initialState,
      { type: 'ADD_CONV', conv: conv('a') },
      { type: 'NAVIGATE', screen: 'chat', convId: 'a' },
    );
    expect(s.screen).toBe('chat');
    expect(s.activeConvId).toBe('a');
    expect(s.navigationHistory).toHaveLength(1);
    expect(s.navigationHistory[0]).toEqual({ screen: 'conversations', activeConvId: null });
  });

  it('GO_BACK pops to the previous screen', () => {
    const s = apply(
      initialState,
      { type: 'ADD_CONV', conv: conv('a') },
      { type: 'NAVIGATE', screen: 'chat', convId: 'a' },
      { type: 'NAVIGATE', screen: 'settings' },
      { type: 'GO_BACK' },
    );
    expect(s.screen).toBe('chat');
    expect(s.activeConvId).toBe('a');
  });

  it('GO_BACK from chat with empty history lands on the conversation list', () => {
    const s = apply(
      initialState,
      { type: 'ADD_CONV', conv: conv('a') },
      { type: 'SET_ACTIVE_CONV', id: 'a' },
      { type: 'SET_SCREEN', screen: 'chat' },
      { type: 'GO_BACK' },
    );
    expect(s.screen).toBe('conversations');
    expect(s.activeConvId).toBeNull();
  });

  it('SET_SCREEN to a root tab clears sub-navigation history', () => {
    const s = apply(
      initialState,
      { type: 'NAVIGATE', screen: 'chat' },
      { type: 'NAVIGATE', screen: 'settings' },
      { type: 'SET_SCREEN', screen: 'conversations' },
    );
    expect(s.navigationHistory).toEqual([]);
  });
});

describe('MCP server + tool state', () => {
  const server = { id: 's1', name: 'S1', url: 'http://x', apiKey: '', enabled: true };

  it('REMOVE_MCP_SERVER also drops that server\u2019s tools', () => {
    const s = apply(
      initialState,
      { type: 'ADD_MCP_SERVER', server },
      { type: 'SET_MCP_TOOLS', tools: [{ name: 't', serverId: 's1', serverName: 'S1', inputSchema: { type: 'object' } }] },
      { type: 'REMOVE_MCP_SERVER', id: 's1' },
    );
    expect(s.mcpServers).toHaveLength(0);
    expect(s.mcpTools).toHaveLength(0);
  });

  it('SET_MCP_CONNECTING toggles membership immutably', () => {
    const s1 = reducer(initialState, { type: 'SET_MCP_CONNECTING', id: 's1', connecting: true });
    expect(s1.mcpConnecting.has('s1')).toBe(true);
    expect(s1.mcpConnecting).not.toBe(initialState.mcpConnecting); // new Set
    const s2 = reducer(s1, { type: 'SET_MCP_CONNECTING', id: 's1', connecting: false });
    expect(s2.mcpConnecting.has('s1')).toBe(false);
  });
});
