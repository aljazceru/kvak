/**
 * Kvak — Conversation List Screen
 */
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, Modal, Pressable, Alert } from 'react-native';
import { useApp } from '../state';
import { getTheme } from '../theme';
import { relativeTime } from '../services/helpers';
import { styles as s } from '../theme';

export const ConversationListScreen: React.FC = React.memo(() => {
  const { state, dispatch, openConversation, forkConversation, exportConversation, deleteConversation } = useApp();
  const c = getTheme(state.isDark);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [sheetId, setSheetId] = useState<string | null>(null);

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
          setSheetId(id);
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
  }, [state.convs, c, renamingId, renameText, openConversation, dispatch]);

  if (convIds.length === 0) {
    return (
      <View style={s.emptyState}>
        <Text style={[s.emptyTitle, { color: c.textPrimary }]}>Kvak</Text>
        <Text style={[s.emptySub, { color: c.textSecondary }]}>On-device AI. Private by default.</Text>
        <Text style={[s.emptyHint, { color: c.accent }]}>Tap ＋ to start</Text>
      </View>
    );
  }

  const sheetConv = sheetId ? state.convs[sheetId] : null;

  return (
    <View style={s.flex}>
      <FlatList
        data={convIds}
        keyExtractor={id => id}
        contentContainerStyle={s.convList}
        renderItem={renderItem}
      />
      {/* ponytail: themed bottom sheet replaces the native Alert.alert long-press
          menu, which on Android rendered as a white box with teal text and broke
          the dark theme. Uses core RN Modal — no new dependency. */}
      <Modal
        transparent
        animationType="slide"
        visible={!!sheetConv}
        onRequestClose={() => setSheetId(null)}
      >
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSheetId(null)}>
          <Pressable
            style={{ marginTop: 'auto', backgroundColor: c.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, borderTopWidth: 1, borderColor: c.border }}
          >
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 14 }} />
            <Text style={{ color: c.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 4 }} numberOfLines={1}>{sheetConv?.title}</Text>
            {[
              { label: 'Rename', action: () => { if (sheetId) { setRenamingId(sheetId); setRenameText(state.convs[sheetId]?.title || ''); } } },
              { label: 'Export', action: () => { if (sheetId) exportConversation(sheetId); } },
              { label: 'Fork', action: () => { if (sheetId) forkConversation(sheetId); } },
              { label: 'Delete', action: () => {
                  if (!sheetId) return;
                  const id = sheetId;
                  const title = state.convs[id]?.title || 'this conversation';
                  Alert.alert(
                    `Delete "${title}"?`,
                    'This will permanently remove the conversation and all its messages. This cannot be undone.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => deleteConversation(id),
                      },
                    ]
                  );
                } },
            ].map(opt => (
              <TouchableOpacity key={opt.label} style={{ paddingVertical: 15, borderBottomWidth: 1, borderColor: c.border }} onPress={() => { setSheetId(null); opt.action(); }}>
                <Text style={{ color: opt.label === 'Delete' ? c.destructive : c.textPrimary, fontSize: 15 }}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={{ paddingVertical: 15, alignItems: 'center', marginTop: 6 }} onPress={() => setSheetId(null)}>
              <Text style={{ color: c.textSecondary, fontSize: 15, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
});
