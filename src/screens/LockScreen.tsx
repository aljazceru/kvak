/**
 * Basic security lock for kvak (Phase for full parity with Kvak).
 * PIN entry (demo 4 digit). In real: use keychain, biometric, duress wipe.
 * On correct PIN, set unlocked in state, show app.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useApp } from '../state';
import { getTheme } from '../theme';
import { styles as s } from '../theme';

export const LockScreen: React.FC = React.memo(() => {
  const { state, dispatch } = useApp();
  const c = getTheme(state.isDark);
  const [pin, setPin] = useState('');
  // Demo PIN "1234" - in full: load from keychain, support setup/duress.
  const CORRECT_PIN = '1234';
  const DURESS_PIN = '0000';

  function submit() {
    if (pin === DURESS_PIN) {
      Alert.alert('Duress', 'Wiping all local data (demo).');
      // In full: dispatch wipe convs/docs/vectors etc, then unlock or exit.
      dispatch({ type: 'SET_DOCUMENTS', documents: [] });
      // etc.
      dispatch({ type: 'SET_SCREEN', screen: 'conversations' }); // or lock false
      return;
    }
    if (pin === CORRECT_PIN) {
      dispatch({ type: 'SET_SCREEN', screen: 'conversations' });
      setPin('');
    } else {
      Alert.alert('Wrong PIN', 'Try 1234 for demo, 0000 duress.');
      setPin('');
    }
  }

  return (
    <View style={[s.flex, { backgroundColor: c.bg, justifyContent: 'center', padding: 32 }]}>
      <Text style={[s.headerTitle, { color: c.textPrimary, textAlign: 'center', marginBottom: 16 }]}>Locked</Text>
      <Text style={{ color: c.textSecondary, textAlign: 'center', marginBottom: 24 }}>Enter PIN to unlock (demo: 1234)</Text>
      <TextInput
        style={[s.composeInput, { backgroundColor: c.surface, color: c.textPrimary, textAlign: 'center', fontSize: 24 }]}
        value={pin}
        onChangeText={setPin}
        keyboardType="numeric"
        maxLength={4}
        secureTextEntry
        autoFocus
        onSubmitEditing={submit}
      />
      <TouchableOpacity onPress={submit} style={[s.modelPrimaryBtn, { backgroundColor: c.accent, marginTop: 16, alignSelf: 'center' }]}>
        <Text style={[s.modelPrimaryText, { color: '#fff' }]}>Unlock</Text>
      </TouchableOpacity>
      <Text style={{ color: c.mutedText, textAlign: 'center', marginTop: 24, fontSize: 12 }}>Duress: 0000 (demo wipes docs)</Text>
    </View>
  );
});