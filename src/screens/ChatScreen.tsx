/**
 * Kvak — Chat Screen
 * Full chat interface with streaming, stop, retry, edit, copy, TTS, STT, tool calls.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  Keyboard,
  NativeEventEmitter,
} from 'react-native';
import { useApp } from '../state';
import { getTheme } from '../theme';
import { styles as s } from '../theme';
import { MarkdownText } from '../components/MarkdownText';
import { SYSTEM_PROMPT_DEFAULT, EMBED_CATALOG } from '../services/constants';
// tool calls handled via useApp().executeToolCalls
import { buildPrompt } from '../services/templates';
import { Llama, Speech, Whisper } from '../services/native';
import { uid } from '../services/helpers';

const emitter = new NativeEventEmitter();

export const ChatScreen: React.FC = React.memo(() => {
  const { state, dispatch, executeToolCalls, getToolPrompt, forkConversation, exportConversation, retrieveRAGContext, loadEmbedModel } = useApp();
  const conv = state.activeConvId ? state.convs[state.activeConvId] : null;
  const c = getTheme(state.isDark);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [sttActive, setSttActive] = useState(false);
  const [sttPartial, setSttPartial] = useState('');
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsId, setTtsId] = useState<string | null>(null);
  // showConvMenu comes from global state (toggled by top gear in chat header)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [sysPrompt, setSysPrompt] = useState(conv?.systemPrompt || '');
  const [showSysPrompt, setShowSysPrompt] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 100);
  }, [conv?.messages.length, streamingText]);

  // ─── Async message finalizer (MCP tools need network) ───────

  async function finalizeMessage(text: string) {
    if (!state.activeConvId) return;
    try {
      let { cleaned, toolCalls } = await executeToolCalls(text, conv?.toolsEnabled ?? false);

      // If tools were used, do a *second generation pass* feeding the tool results back
      // so the model can synthesize a clean final answer. This way the visible output
      // never contains raw "searching the web..." planning text or tool result dumps.
      // The tool use itself is "temporary" (no dedicated message for the call/plan).
      if (toolCalls.length > 0) {
        const toolResText = toolCalls.map(tc => `Tool "${tc.name}" result: ${tc.result}`).join('\n\n');
        // Build a continuation prompt: history up to the (just processed) user query + observation
        const curConv = state.convs[state.activeConvId!];
        const sys = curConv?.systemPrompt || `${SYSTEM_PROMPT_DEFAULT} ${curConv?.toolsEnabled ? getToolPrompt() : 'Be concise.'}`;
        // Note: the raw plan text is intentionally *not* added to history as an assistant msg.
        const continuationMsgs = [
          { id: 'sys', role: 'system' as const, content: sys },
          ...curConv.messages,  // up to the user question
          { id: `toolobs_${uid()}`, role: 'assistant' as const, content: `I used a tool. Here is the result:\n${toolResText}\n\nNow give the final helpful answer to the user (without mentioning the raw tool format or that you "used a tool").` },
        ];
        const contPrompt = buildPrompt(continuationMsgs, state.loadedTemplate);
        try {
          if (Llama && Llama.complete) {
            const finalResponse = await Llama.complete(contPrompt, 256);
            const { cleaned: finalCleaned } = await executeToolCalls(finalResponse, curConv?.toolsEnabled ?? false);
            cleaned = finalCleaned || finalResponse;  // use the synthesized answer
            toolCalls = [];  // do not attach toolCalls to the final visible msg
          }
        } catch (contErr) {
          console.warn('Tool continuation failed, falling back to plan text', contErr);
          // fallback: keep the (now stripped) cleaned + note
          cleaned = cleaned || 'Tool used.';
          toolCalls = [];
        }
      }

      dispatch({
        type: 'ADD_MESSAGE',
        convId: state.activeConvId!,
        message: {
          id: `m_${uid()}`, role: 'assistant', content: cleaned,
          toolCalls: toolCalls.length ? toolCalls : undefined,
        },
      });
    } catch (e: any) {
      dispatch({
        type: 'ADD_MESSAGE',
        convId: state.activeConvId!,
        message: { id: `m_${uid()}`, role: 'assistant', content: e.message || String(e), isError: true },
      });
    }
    setLoading(false);
  }

  // ─── Native event listeners ───────────────────────────────────

  useEffect(() => {
    const tokenSub = emitter.addListener('llamaToken', (token: string) => {
      setStreamingText(prev => prev + token);
    });

    const doneSub = emitter.addListener('llamaStreamDone', () => {
      setStreamingText(prev => {
        if (prev && state.activeConvId) finalizeMessage(prev);
        return '';
      });
    });

    const errorSub = emitter.addListener('llamaStreamError', (err: string) => {
      console.warn('Stream error', err);
    });

    // Whisper STT
    const whisperResult = emitter.addListener('whisperResult', (text: string) => {
      setSttActive(false);
      setSttPartial('');
      if (text) setInput(text);
    });
    const whisperStatus = emitter.addListener('whisperStatus', (status: string) => {
      if (status === 'recording') setSttPartial('Listening…');
      else if (status === 'speech_detected') setSttPartial('Speak now…');
      else if (status === 'transcribing') setSttPartial('Transcribing…');
    });

    // System STT fallback
    const sttResult = emitter.addListener('sttResult', (text: string) => {
      setSttActive(false);
      setSttPartial('');
      if (text) setInput(text);
    });
    const sttError = emitter.addListener('sttError', () => {
      setSttActive(false);
      setSttPartial('');
    });
    const sttEnd = emitter.addListener('sttEnd', () => setSttActive(false));

    // TTS
    const ttsDone = emitter.addListener('ttsDone', () => setTtsPlaying(false));
    const ttsErrorEv = emitter.addListener('ttsError', () => setTtsPlaying(false));

    return () => {
      tokenSub.remove(); doneSub.remove(); errorSub.remove();
      whisperResult.remove(); whisperStatus.remove();
      sttResult.remove(); sttError.remove(); sttEnd.remove();
      ttsDone.remove(); ttsErrorEv.remove();
    };
    // finalizeMessage is a component-scope closure; rebinding all listeners on every render would thrash them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeConvId]);

  // ─── Actions ────────────────────────────────────────────────────

  async function requestMicPermission(): Promise<boolean> {
    try {
      const { PermissionsAndroid } = require('react-native');
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      return r === PermissionsAndroid.RESULTS.GRANTED;
    } catch { return false; }
  }

  async function toggleSTT() {
    if (sttActive) {
      Whisper?.stopRecording();
      Speech?.stopListening();
      setSttActive(false);
      setSttPartial('');
      return;
    }
    const granted = await requestMicPermission();
    if (!granted) {
      Alert.alert('Microphone Required', 'Enable microphone access for voice input.');
      return;
    }
    setSttActive(true);
    setSttPartial('Listening…');
    if (Whisper && state.whisperLoaded) {
      Whisper.startRecording();
    } else if (Speech) {
      Speech.startListening().catch(() => setSttActive(false));
    } else {
      setSttActive(false);
      Alert.alert('Not Available', 'No speech recognition engine found.');
    }
  }

  async function toggleTTS(text: string, msgId: string) {
    if (ttsPlaying && ttsId === msgId) {
      await Speech?.stopSpeaking();
      setTtsPlaying(false);
      setTtsId(null);
    } else {
      setTtsPlaying(true);
      setTtsId(msgId);
      await Speech?.speak(text);
    }
  }

  async function doSend(text: string) {
    if (!text || !state.activeConvId || !state.modelLoaded) return;

    setInput('');
    setLoading(true);
    setStreamingText('');
    Keyboard.dismiss();

    const conv = state.convs[state.activeConvId];

    // Add user message
    dispatch({
      type: 'ADD_MESSAGE',
      convId: state.activeConvId,
      message: { id: `m_${uid()}`, role: 'user', content: text },
    });

    // RAG context injection if enabled for this conv (full RAG)
    let sysContent = conv?.systemPrompt || `${SYSTEM_PROMPT_DEFAULT} ${conv?.toolsEnabled ? getToolPrompt() : 'Be concise.'}`;
    if (conv?.ragEnabled && retrieveRAGContext) {
      try {
        const ragCtx = await retrieveRAGContext(text, 4);
        if (ragCtx) {
          sysContent = (conv?.systemPrompt || SYSTEM_PROMPT_DEFAULT) + '\n' + ragCtx + (conv?.toolsEnabled ? '\n' + getToolPrompt() : '');
        }
      } catch (e) { console.warn('RAG retrieve failed', e); }
    }

    // Auto-title on first message
    if (conv && conv.messages.filter(m => m.role === 'user').length === 0) {
      dispatch({
        type: 'UPDATE_CONV',
        id: state.activeConvId,
        patch: { title: text.length > 50 ? text.slice(0, 47) + '...' : text },
      });
    }

    try {
      const allMsgs = [
        { id: 'sys', role: 'system' as const, content: sysContent },
        ...state.convs[state.activeConvId].messages,
        { id: `m_${uid()}`, role: 'user' as const, content: text },
      ];
      const prompt = buildPrompt(allMsgs, state.loadedTemplate);

      if (Llama && Llama.streamCompletion) {
        await Llama.streamCompletion(prompt, 256);
      } else if (Llama) {
        let response = await Llama.complete(prompt, 256);
        let { cleaned, toolCalls } = await executeToolCalls(response, conv?.toolsEnabled ?? false);

        if (toolCalls.length > 0) {
          // same continuation logic as streaming path for clean final answer
          const toolResText = toolCalls.map(tc => `Tool "${tc.name}" result: ${tc.result}`).join('\n\n');
          const curConv = state.convs[state.activeConvId!];
          const sys = curConv?.systemPrompt || `${SYSTEM_PROMPT_DEFAULT} ${curConv?.toolsEnabled ? getToolPrompt() : 'Be concise.'}`;
          const continuationMsgs = [
            { id: 'sys', role: 'system' as const, content: sys },
            ...curConv.messages,
            { id: `toolobs_${uid()}`, role: 'assistant' as const, content: `I used a tool. Here is the result:\n${toolResText}\n\nNow give the final helpful answer to the user (without mentioning the raw tool format).` },
          ];
          const contPrompt = buildPrompt(continuationMsgs, state.loadedTemplate);
          try {
            const finalResponse = await Llama.complete(contPrompt, 256);
            const { cleaned: finalCleaned } = await executeToolCalls(finalResponse, curConv?.toolsEnabled ?? false);
            cleaned = finalCleaned || finalResponse;
            toolCalls = [];
          } catch (contErr) {
            console.warn('Tool continuation (direct) failed', contErr);
            cleaned = cleaned || 'Tool used.';
            toolCalls = [];
          }
        }

        dispatch({
          type: 'ADD_MESSAGE',
          convId: state.activeConvId!,
          message: {
            id: `m_${uid()}`, role: 'assistant', content: cleaned,
            toolCalls: toolCalls.length ? toolCalls : undefined,
          },
        });
        setLoading(false);
      }
    } catch (e: any) {
      dispatch({
        type: 'ADD_MESSAGE',
        convId: state.activeConvId!,
        message: { id: `m_${uid()}`, role: 'assistant', content: e.message || String(e), isError: true },
      });
      setLoading(false);
    }
  }

  async function send() {
    await doSend(input.trim());
  }

  async function stopGeneration() {
    if (Llama?.stopGeneration) await Llama.stopGeneration();
    setStreamingText(prev => {
      if (prev && state.activeConvId) finalizeMessage(prev);
      return '';
    });
  }

  async function retryLast() {
    if (!state.activeConvId) return;
    dispatch({ type: 'REMOVE_LAST_ASSISTANT', convId: state.activeConvId });
    const conv = state.convs[state.activeConvId];
    const lastUser = [...(conv?.messages || [])].reverse().find(m => m.role === 'user');
    if (lastUser) {
      await doSend(lastUser.content);
    }
  }

  function saveEdit() {
    if (editingId && state.activeConvId && editText.trim()) {
      dispatch({
        type: 'EDIT_MESSAGE',
        convId: state.activeConvId,
        msgId: editingId,
        content: editText.trim(),
      });
    }
    setEditingId(null);
    setEditText('');
  }

  function copyMessage(text: string) {
    const { Clipboard } = require('react-native');
    Clipboard.setString(text);
    Alert.alert('Copied', 'Message copied to clipboard.');
  }

  if (!conv) return <View style={s.flex} />;

  const lastAssistantIdx = conv.messages.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i >= 0).pop();

  return (
    <View style={s.flex}>
      {/* Menu - now the conversation settings, opened via top-right gear in chat header.
          (Bottom "Tools ON" chip removed per requirements.) */}
      {state.showConvMenu && (
        <View style={[s.menuPanel, { backgroundColor: c.card, borderBottomColor: c.border }]}>
          <TouchableOpacity style={s.menuItem} onPress={() => { dispatch({ type: 'SET_SHOW_CONV_MENU', show: false }); setShowSysPrompt(!showSysPrompt); }}>
            <Text style={{ color: c.textPrimary, fontSize: 14 }}>Instructions</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.menuItem} onPress={() => { dispatch({ type: 'SET_SHOW_CONV_MENU', show: false }); forkConversation(conv.id); }}>
            <Text style={{ color: c.textPrimary, fontSize: 14 }}>Fork</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.menuItem} onPress={() => { dispatch({ type: 'SET_SHOW_CONV_MENU', show: false }); exportConversation(conv.id); }}>
            <Text style={{ color: c.textPrimary, fontSize: 14 }}>Export</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.menuItem} onPress={() => {
            dispatch({ type: 'UPDATE_CONV', id: conv.id, patch: { toolsEnabled: !conv.toolsEnabled } });
            dispatch({ type: 'SET_SHOW_CONV_MENU', show: false });
          }}>
            <Text style={{ color: c.textPrimary, fontSize: 14 }}>Tools {conv.toolsEnabled ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.menuItem} onPress={async () => {
            const newVal = ! (conv.ragEnabled ?? false);
            dispatch({ type: 'UPDATE_CONV', id: conv.id, patch: { ragEnabled: newVal } });
            dispatch({ type: 'SET_SHOW_CONV_MENU', show: false });
            if (newVal) {
              if (!state.embedLoaded && loadEmbedModel) {
                const defaultEmbed = EMBED_CATALOG[0];
                await loadEmbedModel(defaultEmbed.filename);
              }
              if (state.documents.length === 0) {
                Alert.alert('No documents', 'Add some in Settings → Document Library first for RAG to help.');
              }
            }
          }}>
            <Text style={{ color: c.textPrimary, fontSize: 14 }}>RAG { (conv.ragEnabled ?? false) ? 'ON' : 'OFF' }</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* System prompt */}
      {showSysPrompt && (
        <View style={[s.sysPromptPanel, { backgroundColor: c.card, borderBottomColor: c.border }]}>
          <Text style={{ color: c.textSecondary, fontSize: 12, marginBottom: 4 }}>System Instructions</Text>
          <TextInput
            style={[s.sysPromptInput, { backgroundColor: c.surface, color: c.textPrimary, borderColor: c.border }]}
            value={sysPrompt}
            onChangeText={t => { setSysPrompt(t); dispatch({ type: 'UPDATE_CONV', id: conv.id, patch: { systemPrompt: t } }); }}
            placeholder="Optional: give the assistant instructions..."
            placeholderTextColor={c.mutedText}
            multiline
          />
        </View>
      )}

      {/* Messages */}
      <ScrollView ref={scrollRef} style={s.chatScroll} contentContainerStyle={s.chatContent}>
        {conv.messages.length === 0 && (
          <View style={s.emptyChat}>
            <Text style={[s.emptyChatTitle, { color: c.textPrimary }]}>Start a conversation</Text>
            <Text style={[s.emptyChatSub, { color: c.textSecondary }]}>All inference runs on your device. Nothing leaves this phone.</Text>
          </View>
        )}

        {conv.messages.map((m, idx) => {
          // Skip empty assistant messages (no text, no tool results) — these are
          // inference no-ops and shouldn't render an empty bubble with dangling actions.
          if (m.role === 'assistant' && !m.content.trim() && !(m.toolCalls && m.toolCalls.length)) return null;
          return (
          <View key={m.id} style={[s.bubbleRow, m.role === 'user' ? s.bubbleRowUser : s.bubbleRowAsst]}>
            <View style={[
              s.bubble,
              m.role === 'user'
                ? { backgroundColor: c.userBubble, borderBottomRightRadius: 4 }
                : { backgroundColor: c.assistantBubble, borderBottomLeftRadius: 4 },
              m.isError && { borderWidth: 1, borderColor: c.destructive },
            ]}>
              {editingId === m.id ? (
                <View>
                  <TextInput
                    style={[s.editInput, { backgroundColor: c.surface, color: c.textPrimary }]}
                    value={editText}
                    onChangeText={setEditText}
                    multiline
                    autoFocus
                    selectTextOnFocus
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <TouchableOpacity onPress={saveEdit} style={[s.actionBtn, { backgroundColor: c.accent }]}>
                      <Text style={{ color: '#fff', fontSize: 12 }}>Save</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setEditingId(null)} style={[s.actionBtn, { backgroundColor: c.border }]}>
                      <Text style={{ color: c.textPrimary, fontSize: 12 }}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : m.isError ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: c.destructive, fontWeight: '700' }}>!</Text>
                  <Text style={[s.bubbleText, { color: c.destructive }]}>{m.content}</Text>
                </View>
              ) : m.content.trim() ? (
                <MarkdownText text={m.content} style={s.bubbleText} theme={c} />
              ) : null}
              {m.toolCalls && m.toolCalls.length > 0 && (
                <Text style={{ fontSize: 11, color: c.mutedText, marginTop: 4, fontStyle: 'italic' }}>
                  🔧 Used tool{m.toolCalls.length > 1 ? 's' : ''}: {m.toolCalls.map(tc => tc.name).join(', ')}
                </Text>
              )}
            </View>

            {/* Actions */}
            <View style={s.msgActions}>
              <TouchableOpacity style={[s.msgAction, { backgroundColor: c.surface }]} onPress={() => copyMessage(m.content)}>
                <Text style={[s.msgActionText, { color: c.textSecondary }]}>Copy</Text>
              </TouchableOpacity>
              {m.role === 'user' && editingId !== m.id && (
                <TouchableOpacity style={[s.msgAction, { backgroundColor: c.surface }]} onPress={() => { setEditingId(m.id); setEditText(m.content); }}>
                  <Text style={[s.msgActionText, { color: c.textSecondary }]}>Edit</Text>
                </TouchableOpacity>
              )}
              {m.role === 'assistant' && !m.isError && (
                <TouchableOpacity style={[s.msgAction, { backgroundColor: (ttsPlaying && ttsId === m.id) ? c.accent + '22' : c.surface }]} onPress={() => toggleTTS(m.content, m.id)}>
                  <Text style={[s.msgActionText, { color: (ttsPlaying && ttsId === m.id) ? c.accent : c.textSecondary }]}>{ttsPlaying && ttsId === m.id ? 'Stop' : 'Listen'}</Text>
                </TouchableOpacity>
              )}
              {m.role === 'assistant' && idx === lastAssistantIdx && !loading && (
                <TouchableOpacity style={[s.msgAction, { backgroundColor: c.surface }]} onPress={retryLast}>
                  <Text style={[s.msgActionText, { color: c.textSecondary }]}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          );
        })}

        {/* Streaming indicator */}
        {loading && streamingText ? (
          <View style={[s.bubbleRow, s.bubbleRowAsst]}>
            <View style={[s.bubble, { backgroundColor: c.assistantBubble, borderBottomLeftRadius: 4 }]}>
              <MarkdownText text={streamingText + ' ▋'} style={s.bubbleText} theme={c} />
            </View>
          </View>
        ) : loading && !streamingText ? (
          <View style={[s.bubbleRow, s.bubbleRowAsst]}>
            <View style={[s.bubble, { backgroundColor: c.assistantBubble, borderBottomLeftRadius: 4 }]}>
              <Text style={{ color: c.textSecondary, fontSize: 14 }}>Thinking…</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Compose bar */}
      <View style={[s.composeBar, { backgroundColor: c.bg, borderTopColor: c.border }]}>
        <TouchableOpacity style={[s.micBtn, { backgroundColor: c.surface }]} onPress={toggleSTT}>
          <Text style={[s.micIcon, sttActive && s.micActive]}>{sttActive ? '⏺' : '🎙️'}</Text>
        </TouchableOpacity>
        <TextInput
          style={[s.composeInput, { backgroundColor: c.surface, color: c.textPrimary }]}
          value={sttActive ? sttPartial : input}
          onChangeText={setInput}
          placeholder={state.modelLoaded ? 'Message' : 'Load a model first (Settings → Model Library)'}
          placeholderTextColor={c.mutedText}
          editable={!loading && state.modelLoaded}
          returnKeyType="send"
          onSubmitEditing={send}
        />
        {loading ? (
          <TouchableOpacity style={[s.sendBtn, { backgroundColor: c.destructive }]} onPress={stopGeneration}>
            <Text style={[s.sendIcon, { color: '#fff' }]}>⏹</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.sendBtn, { backgroundColor: input.trim() ? c.accent : c.surface }]}
            onPress={send}
            disabled={!input.trim()}
          >
            <Text style={[s.sendIcon, { color: input.trim() ? '#fff' : c.mutedText }]}>↑</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom status/footer removed: no more "On-device" or "Tools ON" per requirements.
          Per-conversation settings (incl. Tools toggle) are now in the top gear menu when in chat view. */}
    </View>
  );
});
