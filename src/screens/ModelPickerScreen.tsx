/**
 * Mango × QVAC — Model Picker Screen
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useApp } from '../state';
import { getTheme } from '../theme';
import { styles as s } from '../theme';
import type { ModelInfo } from '../types';
import { formatBytes } from '../services/helpers';
import { Llama } from '../services/native';
import { saveLoadedModel } from '../services/storage';

export const ModelPickerScreen: React.FC = React.memo(() => {
  const { state, dispatch, modelPath } = useApp();
  const [loading, setLoading] = useState<string | null>(null);
  const c = getTheme(state.isDark);

  const maxMB = state.deviceInfo?.maxModelMB ?? 4096;
  const available = MODEL_CATALOG_FULL.filter(m => m.sizeMB <= maxMB);
  const tooBig = MODEL_CATALOG_FULL.filter(m => m.sizeMB > maxMB);

  async function selectModel(model: ModelInfo) {
    if (loading) return;
    const path = modelPath(model.filename);
    const downloaded = state.downloadedFiles.has(model.filename);

    if (!downloaded) {
      setLoading(model.id);
      try { await Llama?.downloadModel(model.url, model.filename); }
      catch (e: any) { Alert.alert('Download Failed', e.message); }
      finally { setLoading(null); }
      return;
    }

    setLoading(model.id);
    try {
      const ok = await Llama?.loadModel(path);
      if (ok) {
        dispatch({
          type: 'SET_MODEL_LOADED',
          loaded: true,
          modelId: `${model.name} (${model.quant})`,
          template: model.template,
        });
        saveLoadedModel(model.filename);
      } else {
        Alert.alert('Load Failed', 'Could not load model.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setLoading(null);
  }

  function renderModel(model: ModelInfo) {
    const isActive = state.loadedModelId?.includes(model.name);
    const isDownloading = state.activeDownloads.has(model.filename);
    const download = state.activeDownloads.get(model.filename);
    const downloaded = state.downloadedFiles.has(model.filename);

    return (
      <View
        key={model.id}
        style={[
          s.modelCard,
          { backgroundColor: c.surface, borderColor: isActive ? c.accent : c.border },
          isActive && s.modelCardActive,
        ]}
      >
        <View style={s.modelTop}>
          <View style={s.modelHeader}>
            <Text style={[s.modelName, { color: c.textPrimary }]}>{model.name}</Text>
            <View style={[s.modelBadge, { backgroundColor: c.accent + '22' }]}>
              <Text style={[s.modelBadgeText, { color: c.accent }]}>{model.quant}</Text>
            </View>
            {downloaded && (
              <View style={[s.modelBadge, { backgroundColor: c.green + '22' }]}>
                <Text style={[s.modelBadgeText, { color: c.green }]}>Saved</Text>
              </View>
            )}
          </View>
          <Text style={[s.modelDesc, { color: c.textSecondary }]}>{model.description}</Text>
        </View>

        {isDownloading && download && (
          <View style={s.progressWrap}>
            <View style={[s.progressBar, { backgroundColor: c.border }]}>
              <View style={[s.progressFill, { backgroundColor: c.accent, width: `${download.pct}%` }]} />
            </View>
            <Text style={[s.progressText, { color: c.textSecondary }]}>
              {formatBytes(download.downloaded)} / {download.total > 0 ? formatBytes(download.total) : '...'} ({download.pct}%)
            </Text>
          </View>
        )}

        <View style={s.modelFooter}>
          <Text style={[s.modelSize, { color: c.textSecondary }]}>
            {model.sizeMB >= 1000 ? `${(model.sizeMB / 1000).toFixed(1)} GB` : `${model.sizeMB} MB`}
          </Text>
          <View style={s.modelActions}>
            {downloaded && !isActive && (
              <TouchableOpacity
                onPress={() => Alert.alert(`Delete ${model.name}?`, 'Remove downloaded file?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete', style: 'destructive', onPress: async () => {
                      await Llama?.deleteFile(modelPath(model.filename));
                      dispatch({ type: 'REMOVE_DOWNLOADED', filename: model.filename });
                      if (state.loadedModelId?.includes(model.name)) {
                        await Llama?.free();
                        dispatch({ type: 'SET_MODEL_LOADED', loaded: false, modelId: '', template: '' });
                        saveLoadedModel(null);
                      }
                    },
                  },
                ])}
                style={s.modelGhostBtn}
              >
                <Text style={{ color: c.destructive, fontSize: 13, fontWeight: '600' }}>Delete</Text>
              </TouchableOpacity>
            )}
            {isActive ? (
              <Text style={[s.modelActive, { color: c.green }]}>● Active</Text>
            ) : downloaded ? (
              <TouchableOpacity onPress={() => selectModel(model)} disabled={!!loading} style={[s.modelPrimaryBtn, { backgroundColor: c.accent }]}>
                <Text style={[s.modelPrimaryText, { color: '#fff' }]}>Load</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => selectModel(model)} disabled={!!loading} style={[s.modelPrimaryBtn, { backgroundColor: c.green }]}>
                {loading === model.id || isDownloading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={[s.modelPrimaryText, { color: '#fff' }]}>Download</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.modelList}>
      <Text style={[s.modelHint, { color: c.textSecondary }]}>Models run on-device via llama.cpp. Downloaded models are cached.</Text>
      {available.map(renderModel)}
      {tooBig.length > 0 && (
        <>
          <Text style={[s.sectionTitle, { color: c.textSecondary }]}>Incompatible (needs more RAM)</Text>
          {tooBig.map(m => (
            <View key={m.id} style={[s.modelCard, { backgroundColor: c.surface, borderColor: c.border }, s.modelCardDisabled]}>
              <View style={s.modelTop}>
                <View style={s.modelHeader}>
                  <Text style={[s.modelName, { color: c.textPrimary }]}>{m.name}</Text>
                  <View style={[s.modelBadge, { backgroundColor: c.accent + '22' }]}>
                    <Text style={[s.modelBadgeText, { color: c.accent }]}>{m.quant}</Text>
                  </View>
                </View>
                <Text style={[s.modelDesc, { color: c.textSecondary }]}>{m.description}</Text>
              </View>
              <View style={s.modelFooter}>
                <Text style={[s.modelSize, { color: c.textSecondary }]}>
                  {m.sizeMB >= 1000 ? `${(m.sizeMB / 1000).toFixed(1)} GB` : `${m.sizeMB} MB`}
                </Text>
                <Text style={{ color: c.orange, fontSize: 11 }}>Too large for this device</Text>
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
});

import { MODEL_CATALOG as MODEL_CATALOG_FULL } from '../services/constants';
