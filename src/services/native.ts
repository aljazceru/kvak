/**
 * Kvak — Native module access
 * Typed wrappers around the JNI native modules.
 */
import { NativeModules } from 'react-native';

export const Llama = NativeModules.LlamaModule as {
  getDeviceInfo(): Promise<{
    totalRamMB: number;
    freeStorageGB: number;
    maxModelMB: number;
    device: string;
    cores: number;
  }>;
  modelDir(): Promise<string>;
  listModels(): Promise<string[]>;
  fileExists(path: string): Promise<boolean>;
  loadModel(path: string): Promise<boolean>;
  complete(prompt: string, maxTokens: number): Promise<string>;
  streamCompletion(prompt: string, maxTokens: number): Promise<void>;
  stopGeneration(): Promise<void>;
  free(): Promise<void>;
  downloadModel(url: string, filename: string): Promise<void>;
  deleteFile(path: string): Promise<void>;

  // Embeddings for full RAG (on-device via llama.cpp)
  loadEmbedModel(path: string): Promise<boolean>;
  getEmbeddings(text: string): Promise<number[]>;  // returns 1D array of floats (e.g. 384 or 768 dim)
  freeEmbedModel(): Promise<void>;

  // SAF helpers for adding folders/documents to RAG (no broad storage perms needed)
  // pickers return the system SAF URI (with persistable permission granted) + display name
  pickDocument(): Promise<{uri: string; name: string} | null>;
  pickDirectory(): Promise<{uri: string; name: string} | null>;
  // list supports optional parentDocId for recursive traversal of subfolders (pass null/undefined for root of the tree)
  listSafDirectory(treeUri: string, parentDocId?: string | null): Promise<Array<{name: string; uri: string; isDirectory: boolean; docId?: string}>>;
  // New: extracts plain text from PDF, EPUB, TXT, MD, HTML etc. using native libs (pdfbox + jsoup).
  // Falls back to raw text read for unknown types. Use this instead of readSafTextDocument for documents.
  extractTextFromDocument(docUri: string, filename?: string | null): Promise<string>;
  // Legacy plain text reader (still used internally by extract for non-PDF/EPUB)
  readSafTextDocument(docUri: string): Promise<string>;
} | null;

export const Speech = NativeModules.SpeechModule as {
  isTTSReady(): Promise<boolean>;
  speak(text: string): Promise<void>;
  stopSpeaking(): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  isListening(): Promise<boolean>;
  isSTTAvailable(): Promise<boolean>;
} | null;

export const Whisper = NativeModules.WhisperModule as {
  loadModel(modelPath: string): Promise<boolean>;
  free(): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  isRecording(): Promise<boolean>;
} | null;
