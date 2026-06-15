/**
 * Mango × QVAC — Conversation List Screen
 */
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useApp } from '../state';
import { getTheme } from '../theme';
import { relativeTime } from '../services/helpers';
import { styles as s } from '../theme';

export const ConversationListScreen: React.FC = React.memo(() => {
  const { state, dispatch, openConversation, forkConversation, exportConversation } = useApp();
  const c = getTheme(state.isDark);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const convIds = Object.keys(state.convs).sort(
    (a, b) => state.convs[b].updatedAt - state.convs[a].updatedAt,
  );

  const renderItem = useCallback(({ item: id }: { item: string }) => {
    const cv = state.convs[id];
    if (!cv) return null;
    const last = cv.messages[cv.messages.length - 1];
    const isRenaming = renamingId === id;

    return (
      <TouchableOpacity
        style={[s.convItem, { backgroundColor: c.surface, borderLeftColor: c.accent }]}
        onPress={() => {
          if (isRenaming) return;
          openConversation(id);
        }}
        activeOpacity={isRenaming ? 1 : 0.2}
        onLongPress={() => {
          if (isRenaming) return;
          Alert.alert(cv.title, undefined, [
            { text: 'Rename', onPress: () => { setRenamingId(id); setRenameText(cv.title); } },
            { text: 'Export', onPress: () => exportConversation(id) },
            { text: 'Fork', onPress: () => forkConversation(id) },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }}
      >
        {isRenaming ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput
              style={{
                flex: 1, fontSize: 16, fontWeight: '600', color: c.textPrimary,
                borderBottomWidth: 1, borderBottomColor: c.accent, paddingVertical: 2,
              }}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                if (renameText.trim()) {
                  dispatch({ type: 'UPDATE_CONV', id, patch: { title: renameText.trim() } });
                }
                setRenamingId(null);
              }}
            />
            <TouchableOpacity
              onPress={() => {
                if (renameText.trim()) {
                  dispatch({ type: 'UPDATE_CONV', id, patch: { title: renameText.trim() } });
                }
                setRenamingId(null);
              }}
              style={[s.actionBtn, { backgroundColor: c.accent }]}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setRenamingId(null)}
              style={[s.actionBtn, { backgroundColor: c.border }]}
            >
              <Text style={{ color: c.textPrimary, fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={s.convItemTop}>
              <Text style={[s.convTitle, { color: c.textPrimary }]} numberOfLines={1}>{cv.title}</Text>
              <Text style={[s.convDate, { color: c.textSecondary }]}>{relativeTime(cv.updatedAt)}</Text>
            </View>
            {last ? (
              <Text style={[s.convPreview, { color: c.textSecondary }]} numberOfLines={2}>
                {last.content?.trim()
                  ? last.content
                  : last.toolCalls?.length
                    ? `Used ${last.toolCalls[0].name}`
                    : ''}
              </Text>
            ) : null}
          </>
        )}
      </TouchableOpacity>
    );
  }, [state.convs, c, renamingId, renameText, openConversation, forkConversation, exportConversation, dispatch]);

  if (convIds.length === 0) {
    return (
      <View style={s.emptyState}>
        <Text style={[s.emptyTitle, { color: c.textPrimary }]}>Mango × QVAC</Text>
        <Text style={[s.emptySub, { color: c.textSecondary }]}>On-device AI. Private by default.</Text>
        <Text style={[s.emptyHint, { color: c.accent }]}>Tap ＋ to start</Text>
      </View>
    );
  }

  return (
    <View style={s.flex}>
      <FlatList
        data={convIds}
        keyExtractor={id => id}
        contentContainerStyle={s.convList}
        renderItem={renderItem}
      />
    </View>
  );
});
