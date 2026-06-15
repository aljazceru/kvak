/**
 * Mango × QVAC — Settings Screen
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useApp } from '../state';
import { getTheme } from '../theme';
import { styles as s } from '../theme';
import { WHISPER_CATALOG } from '../services/constants';
import { formatBytes } from '../services/helpers';
import { Whisper } from '../services/native';
import type { MCPServerConfig, UnifiedMCPServerConfig } from '../types';
import { uid } from '../services/helpers';

export const SettingsScreen: React.FC = React.memo(() => {
  const { state, dispatch, modelPath, unloadModel, forceRender, connectMCPServer, disconnectMCPServer, connectNostrServer, disconnectNostrServer } = useApp();
  const c = getTheme(state.isDark);

  // HTTP MCP form
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpName, setMcpName] = useState('');
  const [mcpKey, setMcpKey] = useState('');

  // Nostr MCP form
  const [nostrName, setNostrName] = useState('');
  const [nostrPubkey, setNostrPubkey] = useState('');
  const [nostrRelays, setNostrRelays] = useState('');

  const ramMB = state.deviceInfo ? `${Math.round(state.deviceInfo.totalRamMB / 1024 * 10) / 10} GB` : '...';
  const storageGB = state.deviceInfo ? `${Math.round(state.deviceInfo.freeStorageGB * 10) / 10} GB free` : '...';

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.settingsContent}>
      {/* Active Model */}
      <Text style={[s.sectionTitle, { color: c.textSecondary }]}>Active Model</Text>
      <View style={[s.modelStatusCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={s.modelStatusRow}>
          <Text style={s.modelStatusIcon}>{state.modelLoaded ? '●' : '○'}</Text>
          <View style={s.modelStatusInfo}>
            <Text style={[s.modelStatusName, { color: c.textPrimary }]}>{state.loadedModelId || 'No model loaded'}</Text>
            <Text style={[s.modelStatusDetail, { color: c.textSecondary }]}>
              {state.modelLoaded ? 'Running on-device via llama.cpp' : 'Select from library below'}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: c.accent, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}
            onPress={() => dispatch({ type: 'SET_SCREEN', screen: 'model_picker' })}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Model Library</Text>
          </TouchableOpacity>
          {state.modelLoaded && (
            <TouchableOpacity style={{ flex: 1, backgroundColor: c.destructive, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }} onPress={unloadModel}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Unload</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Device */}
      <Text style={[s.sectionTitle, { color: c.textSecondary }]}>Device</Text>
      <View style={[s.deviceCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[s.deviceRow, { color: c.textSecondary }]}>RAM: {ramMB}</Text>
        <Text style={[s.deviceRow, { color: c.textSecondary }]}>Storage: {storageGB}</Text>
        <Text style={[s.deviceRow, { color: c.textSecondary }]}>{state.deviceInfo?.device || 'Android'}</Text>
        <Text style={[s.deviceRow, { color: c.textSecondary }]}>Cores: {state.deviceInfo?.cores || '?'}</Text>
      </View>

      {/* STT */}
      <Text style={[s.sectionTitle, { color: c.textSecondary }]}>Voice Input (STT)</Text>
      <View style={[s.deviceCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={s.modelStatusRow}>
          <Text style={s.modelStatusIcon}>{state.whisperLoaded ? '●' : '○'}</Text>
          <View style={s.modelStatusInfo}>
            <Text style={[s.modelStatusName, { color: c.textPrimary }]}>
              {state.whisperLoaded ? `Whisper ${WHISPER_CATALOG.find(w => w.id === state.whisperModelId)?.name || 'loaded'}` : 'No STT model'}
            </Text>
            <Text style={[s.modelStatusDetail, { color: c.textSecondary }]}>
              {state.whisperLoaded ? 'On-device speech recognition. Tap the mic to speak.' : 'Download a Whisper model for voice input.'}
            </Text>
          </View>
        </View>
        {WHISPER_CATALOG.map(wm => {
          const dl = state.downloadedFiles.has(wm.filename);
          const active = state.whisperModelId === wm.id;
          const downloading = state.activeDownloads.has(wm.filename);
          return (
            <View key={wm.id} style={[s.whisperRow, { borderTopColor: c.border }]}>
              <View style={s.whisperInfo}>
                <Text style={[s.whisperName, { color: c.textPrimary }]}>
                  {wm.name} {active ? '(active)' : dl ? '(downloaded)' : ''}
                </Text>
                <Text style={[s.whisperDesc, { color: c.textSecondary }]}>{wm.description} ({wm.sizeMB} MB)</Text>
              </View>
              {active ? (
                <Text style={[s.whisperActive, { color: c.green }]}>Active</Text>
              ) : dl ? (
                <TouchableOpacity style={s.whisperLoadBtn} onPress={async () => {
                  if (Whisper) {
                    await Whisper.free().catch(() => {});
                    const ok = await Whisper.loadModel(modelPath(wm.filename));
                    if (ok) {
                      dispatch({ type: 'SET_WHISPER', loaded: true, modelId: wm.id });
                      forceRender();
                    } else {
                      Alert.alert('Error', 'Failed to load whisper model');
                    }
                  }
                }}>
                  <Text style={[s.whisperLoadText, { color: c.accent }]}>Load</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={s.whisperLoadBtn} disabled={downloading} onPress={async () => {
                  try { await (await import('../services/native')).Llama?.downloadModel(wm.url, wm.filename); }
                  catch (e: any) { Alert.alert('Download Failed', e.message); }
                }}>
                  {downloading ? (
                    <ActivityIndicator color={c.accent} size="small" />
                  ) : (
                    <Text style={[s.whisperDLText, { color: c.green }]}>Download ({wm.sizeMB} MB)</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      {/* TTS */}
      <Text style={[s.sectionTitle, { color: c.textSecondary }]}>Voice Output (TTS)</Text>
      <View style={[s.deviceCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={s.modelStatusRow}>
          <Text style={s.modelStatusIcon}>{state.ttsReady ? '●' : '○'}</Text>
          <View style={s.modelStatusInfo}>
            <Text style={[s.modelStatusName, { color: c.textPrimary }]}>
              {state.ttsReady ? 'System TTS Ready' : 'Starting TTS...'}
            </Text>
            <Text style={[s.modelStatusDetail, { color: c.textSecondary }]}>
              {state.ttsReady ? 'Tap the speaker icon on any message to hear it' : 'Connecting to speech engine...'}
            </Text>
          </View>
        </View>
      </View>

      {/* MCP Servers */}
      <Text style={[s.sectionTitle, { color: c.textSecondary }]}>MCP Servers</Text>
      <View style={[s.deviceCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[s.deviceRow, { color: c.textSecondary, marginBottom: 8 }]}>Connect to remote MCP tool servers (e.g. http://192.168.1.100:3000/mcp)</Text>

        {/* Add server form */}
        <View style={{ gap: 6, marginBottom: 12 }}>
          <TextInput
            style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: c.textPrimary, backgroundColor: c.bg }}
            placeholder="Server URL (e.g. http://localhost:3000)"
            placeholderTextColor={c.mutedText}
            value={mcpUrl}
            onChangeText={setMcpUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput
              style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: c.textPrimary, backgroundColor: c.bg }}
              placeholder="Name (optional)"
              placeholderTextColor={c.mutedText}
              value={mcpName}
              onChangeText={setMcpName}
            />
            <TextInput
              style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: c.textPrimary, backgroundColor: c.bg }}
              placeholder="API key (optional)"
              placeholderTextColor={c.mutedText}
              value={mcpKey}
              onChangeText={setMcpKey}
              autoCapitalize="none"
            />
          </View>
          <TouchableOpacity
            style={{ backgroundColor: c.accent, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}
            onPress={async () => {
              const url = mcpUrl.trim();
              if (!url) { Alert.alert('Error', 'Enter a server URL'); return; }
              const server: MCPServerConfig = {
                id: `mcp_${uid()}`,
                name: mcpName.trim() || new URL(url).hostname,
                url, apiKey: mcpKey.trim(), enabled: false,
              };
              dispatch({ type: 'ADD_MCP_SERVER', server });
              setMcpUrl(''); setMcpName(''); setMcpKey('');
              await connectMCPServer(server);
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Add & Connect</Text>
          </TouchableOpacity>
        </View>

        {/* Server list */}
        {state.mcpServers.map(server => {
          const connecting = state.mcpConnecting.has(server.id);
          const connected = server.enabled;
          const tools = state.mcpTools.filter(t => t.serverId === server.id);
          return (
            <View key={server.id} style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, marginTop: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: connected ? c.green : connecting ? c.yellow : c.destructive, fontSize: 12 }}>
                      {connecting ? '●' : connected ? '●' : '○'}
                    </Text>
                    <Text style={{ color: c.textPrimary, fontWeight: '600', fontSize: 14 }}>{server.name}</Text>
                  </View>
                  <Text style={{ color: c.textSecondary, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{server.url}</Text>
                  {tools.length > 0 && (
                    <Text style={{ color: c.accent, fontSize: 11, marginTop: 2 }}>
                      {tools.length} tools: {tools.map(t => t.name).join(', ')}
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {connected ? (
                    <TouchableOpacity onPress={() => disconnectMCPServer(server.id)}>
                      <Text style={{ color: c.orange, fontSize: 12, fontWeight: '600' }}>Disconnect</Text>
                    </TouchableOpacity>
                  ) : !connecting ? (
                    <TouchableOpacity onPress={() => connectMCPServer(server)}>
                      <Text style={{ color: c.accent, fontSize: 12, fontWeight: '600' }}>Connect</Text>
                    </TouchableOpacity>
                  ) : (
                    <ActivityIndicator color={c.accent} size="small" />
                  )}
                  <TouchableOpacity onPress={() => {
                    Alert.alert(`Remove ${server.name}?`, 'Remove this MCP server?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => {
                        disconnectMCPServer(server.id);
                        dispatch({ type: 'REMOVE_MCP_SERVER', id: server.id });
                      }},
                    ]);
                  }}>
                    <Text style={{ color: c.destructive, fontSize: 12 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}

        {state.mcpServers.length === 0 && (
          <Text style={{ color: c.mutedText, fontSize: 12, textAlign: 'center', marginTop: 4 }}>No MCP servers configured</Text>
        )}
      </View>

      {/* Nostr MCP Servers (ContextVM) */}
      <Text style={[s.sectionTitle, { color: c.textSecondary }]}>Nostr MCP Servers (ContextVM)</Text>
      <View style={[s.deviceCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[s.deviceRow, { color: c.textSecondary, marginBottom: 8 }]}>
          Connect to remote MCP tool servers over Nostr relays. End-to-end encrypted via NIP-44.
        </Text>

        {/* Nostr server form */}
        <View style={{ gap: 6, marginBottom: 12 }}>
          <TextInput
            style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: c.textPrimary, backgroundColor: c.bg }}
            placeholder="Server name (e.g. My Tool Server)"
            placeholderTextColor={c.mutedText}
            value={nostrName}
            onChangeText={setNostrName}
          />
          <TextInput
            style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: c.textPrimary, backgroundColor: c.bg, fontFamily: 'monospace' }}
            placeholder="Server pubkey (hex or npub...)"
            placeholderTextColor={c.mutedText}
            value={nostrPubkey}
            onChangeText={setNostrPubkey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: c.textPrimary, backgroundColor: c.bg, fontFamily: 'monospace' }}
            placeholder="Relay URLs (comma-separated, e.g. wss://relay.damus.io)"
            placeholderTextColor={c.mutedText}
            value={nostrRelays}
            onChangeText={setNostrRelays}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={{ backgroundColor: '#9333ea', borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}
            onPress={async () => {
              const name = nostrName.trim() || 'Nostr Server';
              const pubkey = nostrPubkey.trim();
              const relays = nostrRelays.split(',').map(r => r.trim()).filter(Boolean);
              if (!pubkey) { Alert.alert('Error', 'Enter a server public key'); return; }
              if (relays.length === 0) { Alert.alert('Error', 'Enter at least one relay URL'); return; }
              const server: UnifiedMCPServerConfig = {
                id: `nostr_${uid()}`,
                name,
                type: 'nostr',
                enabled: false,
                serverPubkey: pubkey,
                relayUrls: relays,
              };
              dispatch({ type: 'ADD_NOSTR_SERVER', server });
              setNostrName(''); setNostrPubkey(''); setNostrRelays('');
              await connectNostrServer(server);
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Add & Connect (Nostr)</Text>
          </TouchableOpacity>
        </View>

        {/* Nostr server list */}
        {state.nostrServers.map(server => {
          const connecting = state.nostrConnecting.has(server.id);
          const connected = server.enabled;
          const tools = state.nostrTools.filter(t => t.serverId === server.id);
          return (
            <View key={server.id} style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, marginTop: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: connected ? c.green : connecting ? c.yellow : c.destructive, fontSize: 12 }}>
                      {connecting ? '●' : connected ? '●' : '○'}
                    </Text>
                    <Text style={{ color: c.textPrimary, fontWeight: '600', fontSize: 14 }}>{server.name}</Text>
                    <Text style={{ color: '#9333ea', fontSize: 10, fontWeight: '500' }}>NOSTR</Text>
                  </View>
                  <Text style={{ color: c.textSecondary, fontSize: 11, marginTop: 2, fontFamily: 'monospace' }} numberOfLines={1}>
                    {(server.serverPubkey || '').slice(0, 20)}...
                  </Text>
                  <Text style={{ color: c.textSecondary, fontSize: 10, marginTop: 1 }} numberOfLines={1}>
                    {(server.relayUrls || []).join(', ')}
                  </Text>
                  {tools.length > 0 && (
                    <Text style={{ color: '#9333ea', fontSize: 11, marginTop: 2 }}>
                      {tools.length} tools: {tools.map(t => t.name).join(', ')}
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {connected ? (
                    <TouchableOpacity onPress={() => disconnectNostrServer(server.id)}>
                      <Text style={{ color: c.orange, fontSize: 12, fontWeight: '600' }}>Disconnect</Text>
                    </TouchableOpacity>
                  ) : !connecting ? (
                    <TouchableOpacity onPress={() => connectNostrServer(server)}>
                      <Text style={{ color: '#9333ea', fontSize: 12, fontWeight: '600' }}>Connect</Text>
                    </TouchableOpacity>
                  ) : (
                    <ActivityIndicator color="#9333ea" size="small" />
                  )}
                  <TouchableOpacity onPress={() => {
                    Alert.alert(`Remove ${server.name}?`, 'Remove this Nostr MCP server?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => {
                        disconnectNostrServer(server.id);
                        dispatch({ type: 'REMOVE_NOSTR_SERVER', id: server.id });
                      }},
                    ]);
                  }}>
                    <Text style={{ color: c.destructive, fontSize: 12 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}

        {state.nostrServers.length === 0 && (
          <Text style={{ color: c.mutedText, fontSize: 12, textAlign: 'center', marginTop: 4 }}>No Nostr MCP servers configured</Text>
        )}
      </View>

      {/* Appearance */}
      <Text style={[s.sectionTitle, { color: c.textSecondary }]}>Appearance</Text>
      <View style={[s.deviceCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <TouchableOpacity
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          onPress={() => dispatch({ type: 'SET_THEME', dark: !state.isDark })}
        >
          <Text style={[s.deviceRow, { color: c.textSecondary, marginBottom: 0 }]}>Theme</Text>
          <Text style={{ color: c.accent, fontSize: 14 }}>{state.isDark ? 'Dark' : 'Light'}</Text>
        </TouchableOpacity>
      </View>

      {/* About */}
      <Text style={[s.sectionTitle, { color: c.textSecondary }]}>About</Text>
      <View style={[s.aboutCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[s.aboutTitle, { color: c.textPrimary }]}>Mango × QVAC</Text>
        <Text style={[s.aboutText, { color: c.textSecondary }]}>
          Local AI on your phone via llama.cpp. No data leaves your device.
        </Text>
      </View>
    </ScrollView>
  );
});
