/**
 * Mango × QVAC — On-Device AI Chat
 * Production-grade architecture: Context state, persistence, error boundaries,
 * streaming, stop, copy, markdown, rename, timestamps, errors, retry,
 * system prompt, unload, fork, export, edit, dark/light theme.
 *
 * @format
 */
import React, { useEffect } from 'react';
import {
  View, Text, TouchableOpacity,
  StatusBar, BackHandler,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppProvider, useApp } from './src/state';
import { useKeyboardHeight } from './src/hooks/useKeyboardHeight';
import { getTheme, statusBarStyle, styles as s } from './src/theme';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { ConversationListScreen } from './src/screens/ConversationListScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ModelPickerScreen } from './src/screens/ModelPickerScreen';

function AppInner() {
  const { state, dispatch, newConversation } = useApp();
  const c = getTheme(state.isDark);
  const conv = state.activeConvId ? state.convs[state.activeConvId] : null;

  // Android back gesture/button
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.screen === 'model_picker') {
        dispatch({ type: 'SET_SCREEN', screen: 'settings' });
        return true;
      }
      if (state.screen === 'chat') {
        dispatch({ type: 'SET_SCREEN', screen: 'conversations' });
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [state.screen, dispatch]);

  const insets = useSafeAreaInsets();
  const chatsActive = state.screen === 'conversations' || state.screen === 'chat';
  const settingsActive = state.screen === 'settings';
  // Lift the whole window above the soft keyboard so the compose bar (and the
  // text being typed) stays visible. Adjusts for edge-to-edge on targetSdk 35+.
  const keyboardHeight = useKeyboardHeight();
  const paddingBottom = Math.max(insets.bottom, keyboardHeight);

  return (
    <View style={[s.root, { backgroundColor: c.bg, paddingTop: insets.top, paddingBottom }]}>
      <StatusBar barStyle={statusBarStyle(state.isDark)} />

      {/* Header */}
      <View style={[s.header, { backgroundColor: c.bg, borderBottomColor: c.border }]}>
        {state.screen === 'chat' && conv ? (
          <>
            <TouchableOpacity
              onPress={() => dispatch({ type: 'SET_SCREEN', screen: 'conversations' })}
              style={s.headerBtn}
            >
              <Text style={[s.headerBtnText, { color: c.accent }]}>‹ Back</Text>
            </TouchableOpacity>
            <View style={s.headerCenter}>
              <Text style={[s.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
                {conv.title}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => dispatch({ type: 'SET_SCREEN', screen: 'settings' })}
              style={s.headerBtn}
            >
              <Text style={{ fontSize: 18 }}>⚙️</Text>
            </TouchableOpacity>
          </>
        ) : state.screen === 'model_picker' ? (
          <>
            <TouchableOpacity
              onPress={() => dispatch({ type: 'SET_SCREEN', screen: 'settings' })}
              style={s.headerBtn}
            >
              <Text style={[s.headerBtnText, { color: c.accent }]}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={[s.headerTitle, { color: c.textPrimary }]}>Model Library</Text>
            <View style={s.headerBtn} />
          </>
        ) : (
          <>
            <View style={s.headerBtn} />
            <Text style={[s.headerTitle, { color: c.textPrimary }]}>
              {state.screen === 'settings' ? 'Settings' : 'Mango × QVAC'}
            </Text>
            <View style={s.headerBtn} />
          </>
        )}
      </View>



      {/* Screen content */}
      {state.screen === 'chat' && conv ? (
        <ChatScreen />
      ) : state.screen === 'settings' ? (
        <SettingsScreen />
      ) : state.screen === 'model_picker' ? (
        <ModelPickerScreen />
      ) : (
        <ConversationListScreen />
      )}

      {/* Tab bar — hidden on model_picker (has its own back nav) */}
      {state.screen !== 'model_picker' && (
      <View style={[s.tabBar, { backgroundColor: c.bg, borderTopColor: c.border }]}>
        <TouchableOpacity
          style={s.tab}
          onPress={() => dispatch({ type: 'SET_SCREEN', screen: 'conversations' })}
        >
          <View style={[s.tabPill, chatsActive && { backgroundColor: c.accent + '22' }]}>
            <Text style={[s.tabLabel, { color: chatsActive ? c.accent : c.textSecondary }, chatsActive && s.tabActiveLabel]}>Chats</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabNew, { backgroundColor: c.accent }]}
          onPress={newConversation}
        >
          <Text style={[s.tabNewIcon, { color: c.bg }]}>＋</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.tab}
          onPress={() => dispatch({ type: 'SET_SCREEN', screen: 'settings' })}
        >
          <View style={[s.tabPill, settingsActive && { backgroundColor: c.accent + '22' }]}>
            <Text style={[s.tabLabel, { color: settingsActive ? c.accent : c.textSecondary }, settingsActive && s.tabActiveLabel]}>Settings</Text>
          </View>
        </TouchableOpacity>
      </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppProvider>
          <AppInner />
        </AppProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
