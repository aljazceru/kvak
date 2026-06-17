/**
 * Kvak — Document Library for full RAG
 * Supports paste text + native system file/folder pickers (Android SAF via OpenDocument + OpenDocumentTree).
 * Matches Kvak's UX: real dialog (not path typing), persistable permissions, recursive ingest.
 * Supports PDF, EPUB, TXT, MD, HTML etc via native extraction (pdfbox-android + jsoup in LlamaModule).
 * Full support for documents and folders (recursive text ingest using listSaf + extractTextFromDocument).
 * Integrates with embeddings, retrieval, per-conv RAG toggle in gear, and prompt injection.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, TextInput, Modal, ActivityIndicator } from 'react-native';
import { useApp } from '../state';
import { getTheme } from '../theme';
import { styles as s } from '../theme';
import { Llama } from '../services/native';

export const DocumentLibraryScreen: React.FC = React.memo(() => {
  const { state, dispatch, addRAGDocument } = useApp();
  const c = getTheme(state.isDark);
  const [adding, setAdding] = useState(false);
  const [pasteVisible, setPasteVisible] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteContent, setPasteContent] = useState('');

  async function handlePasteAdd() {
    if (!pasteTitle.trim() || !pasteContent.trim()) {
      Alert.alert('Missing', 'Title and content required.');
      return;
    }
    setAdding(true);
    try {
      await addRAGDocument(pasteTitle.trim(), pasteContent.trim(), 'paste');
      setPasteTitle(''); setPasteContent(''); setPasteVisible(false);
    } catch (e: any) {
      Alert.alert('Add failed', e.message);
    }
    setAdding(false);
  }

  // SAF-native document picker (matches Kvak: system dialog, persistable grant, no path entry)
  async function handlePickDocument() {
    if (!(Llama as any)?.pickDocument) {
      Alert.alert('Unsupported', 'Native document picker not available (rebuild APK after native changes). Use paste for now.');
      return;
    }
    setAdding(true);
    try {
      const picked = await (Llama as any).pickDocument();
      if (!picked) return; // user cancelled
      const content: string = (await (Llama as any)?.extractTextFromDocument?.(picked.uri, picked.name)) || '';
      if (!content || content.trim().length < 5) {
        Alert.alert('No text', 'Selected file has no readable text content (or extraction failed for this PDF/EPUB).');
        return;
      }
      await addRAGDocument(picked.name || 'Document', content, 'file');
    } catch (e: any) {
      Alert.alert('Add document failed', e?.message || String(e));
    } finally {
      setAdding(false);
    }
  }

  // Recursive SAF ingest for a picked folder tree (using listSaf + extractTextFromDocument).
  // Supports PDF, EPUB + plain text (txt/md/html etc). Extraction happens in native (pdfbox + jsoup).
  // Mirrors previous path version + Kvak's traverseTree style (BFS via docId).
  async function ingestSafFolderRecursive(
    treeUri: string,
    folderName: string,
    maxDepth = 3,
    maxFiles = 100,
    currentDepth = 0,
    parentDocId: string | null = null
  ): Promise<number> {
    if (currentDepth > maxDepth) return 0;
    let added = 0;
    const supportedExts = ['.txt', '.md', '.text', '.pdf', '.epub', '.html', '.htm', '.xhtml'];
    try {
      const items: any[] = (await (Llama as any)?.listSafDirectory?.(treeUri, parentDocId)) || [];
      for (const item of items) {
        if (added >= maxFiles) break;
        const lower = item.name.toLowerCase();
        if (item.isDirectory) {
          const subDocId = (item as any).docId || null;
          const subAdded = await ingestSafFolderRecursive(treeUri, `${folderName}/${item.name}`, maxDepth, maxFiles, currentDepth + 1, subDocId);
          added += subAdded;
          if (added >= maxFiles) break;
        } else if (supportedExts.some(ext => lower.endsWith(ext))) {
          try {
            const content: string = (await (Llama as any)?.extractTextFromDocument?.(item.uri, item.name)) || '';
            if (content && content.trim().length > 10) {
              await addRAGDocument(`${folderName}/${item.name}`, content, 'directory');
              added++;
            }
          } catch (readErr) {
            console.warn('extract err for', item.name, readErr);
          }
        }
      }
    } catch (e) {
      console.warn('listSaf err', e);
    }
    if (currentDepth === 0 && added === 0) {
      await addRAGDocument(folderName, `Folder added via picker: ${treeUri}. No supported files (pdf/epub/txt/md etc, depth limit ${maxDepth}).`, 'directory');
    }
    return added;
  }

  // SAF folder picker (OpenDocumentTree) + recursive ingest of text files.
  async function handlePickFolder() {
    if (!(Llama as any)?.pickDirectory) {
      Alert.alert('Unsupported', 'Native folder picker not available (rebuild APK after native changes).');
      return;
    }
    setAdding(true);
    try {
      const picked = await (Llama as any).pickDirectory();
      if (!picked) return; // cancelled
      // ponytail: count unused for now; keep ingest silent (matches paste flow).
      await ingestSafFolderRecursive(picked.uri, picked.name || 'Folder');
    } catch (e: any) {
      Alert.alert('Add folder failed', e?.message || String(e));
    } finally {
      setAdding(false);
    }
  }

  async function removeDoc(id: string, title: string) {
    Alert.alert(`Delete ${title}?`, 'Remove from RAG index?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
          dispatch({ type: 'REMOVE_DOCUMENT', id });
          // vectors are cleaned? for MVP on next add or manual; simple clear if want
          // better: filter vectors by docId in reducer, but for now re-add cleans on restart or implement filter
        } },
    ]);
  }

  return (
    <View style={s.flex}>
      <ScrollView style={s.flex} contentContainerStyle={s.settingsContent}>
        <Text style={[s.modelHint, { color: c.textSecondary }]}>Ingest documents for semantic RAG (PDF, EPUB, TXT, MD, HTML...). Content kept locally. (Embed model auto-loads when RAG enabled for a conv.)</Text>

        <TouchableOpacity onPress={() => setPasteVisible(true)} disabled={adding} style={[s.modelPrimaryBtn, { backgroundColor: c.accent, marginVertical: 8 }]}>
          <Text style={[s.modelPrimaryText, { color: '#fff' }]}>+ Paste Text</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handlePickDocument} disabled={adding} style={[s.modelPrimaryBtn, { backgroundColor: c.green, marginVertical: 8 }]}>
          <Text style={[s.modelPrimaryText, { color: '#fff' }]}>Add Document (picker: PDF/EPUB/TXT...)</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handlePickFolder} disabled={adding} style={[s.modelPrimaryBtn, { backgroundColor: c.accent, marginVertical: 8 }]}>
          <Text style={[s.modelPrimaryText, { color: '#fff' }]}>Add Folder (picker, recurses PDF/EPUB/TXT/MD...)</Text>
        </TouchableOpacity>

        <Text style={[s.sectionTitle, { color: c.textSecondary }]}>Your Documents ({state.documents.length})</Text>
        {state.documents.length === 0 && (
          <Text style={[s.emptyHint, { color: c.textSecondary }]}>No documents yet. Add some to use in chat (toggle RAG in conversation gear menu).</Text>
        )}
        {state.documents.map(doc => (
          <View key={doc.id} style={[s.convItem, { backgroundColor: c.surface, borderLeftColor: c.accent }]}>
            <View style={s.convItemTop}>
              <Text style={[s.convTitle, { color: c.textPrimary }]} numberOfLines={1}>{doc.title}</Text>
              <TouchableOpacity onPress={() => removeDoc(doc.id, doc.title)}>
                <Text style={{ color: c.destructive, fontSize: 14 }}>Delete</Text>
              </TouchableOpacity>
            </View>
            <Text style={[s.convPreview, { color: c.textSecondary }]} numberOfLines={2}>{doc.content.slice(0, 120)}...</Text>
            <Text style={{ color: c.mutedText, fontSize: 11 }}>{doc.chunks} chunks • {doc.source} • {new Date(doc.addedAt).toLocaleDateString()}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Paste modal (still useful for quick notes without leaving the app) */}
      <Modal visible={pasteVisible} transparent animationType="slide" onRequestClose={() => setPasteVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 12, padding: 16 }}>
            <Text style={{ color: c.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 8 }}>Add Text Document</Text>
            <TextInput
              style={{ backgroundColor: c.surface, color: c.textPrimary, padding: 8, borderRadius: 6, marginBottom: 8 }}
              placeholder="Title (e.g. My Notes)"
              placeholderTextColor={c.mutedText}
              value={pasteTitle}
              onChangeText={setPasteTitle}
            />
            <TextInput
              style={{ backgroundColor: c.surface, color: c.textPrimary, padding: 8, borderRadius: 6, minHeight: 120, textAlignVertical: 'top' }}
              placeholder="Paste or type document content here..."
              placeholderTextColor={c.mutedText}
              multiline
              value={pasteContent}
              onChangeText={setPasteContent}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
              <TouchableOpacity onPress={() => { setPasteVisible(false); setPasteTitle(''); setPasteContent(''); }} style={{ padding: 10 }}>
                <Text style={{ color: c.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handlePasteAdd} disabled={adding} style={{ padding: 10, marginLeft: 16 }}>
                {adding ? <ActivityIndicator color={c.accent} /> : <Text style={{ color: c.accent, fontWeight: '600' }}>Add & Embed</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
});