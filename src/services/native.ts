/**
 * Mango × QVAC — Native module access
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
