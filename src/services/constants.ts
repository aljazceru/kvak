/**
 * Kvak — Model catalogs and constants
 */
import type { ModelInfo, WhisperModelInfo } from '../types';

export const MODEL_CATALOG: ModelInfo[] = [
  { id: 'tinyllama-q4', name: 'TinyLlama 1.1B', quant: 'Q4_0', sizeMB: 637, description: 'Ultra-fast. Good for testing.', url: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_0.gguf', filename: 'tinyllama-1.1b-chat-v1.0.Q4_0.gguf', template: 'llama3' },
  { id: 'tinyllama-q5', name: 'TinyLlama 1.1B', quant: 'Q5_K_M', sizeMB: 865, description: 'Better quality, still fast.', url: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q5_K_M.gguf', filename: 'tinyllama-1.1b-chat-v1.0.Q5_K_M.gguf', template: 'llama3' },
  { id: 'qwen-1.5b', name: 'Qwen 2.5 1.5B', quant: 'Q4_K_M', sizeMB: 1100, description: 'Excellent small model. Great multilingual support.', url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf', filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf', template: 'qwen' },
  { id: 'qwen-3b', name: 'Qwen 2.5 3B', quant: 'Q4_K_M', sizeMB: 1980, description: 'Strong reasoning for its size. Best 3B model.', url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf', filename: 'qwen2.5-3b-instruct-q4_k_m.gguf', template: 'qwen' },
  { id: 'llama3.2-1b', name: 'Llama 3.2 1B', quant: 'Q4_K_M', sizeMB: 905, description: "Meta's latest. Native tool use support.", url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf', filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf', template: 'llama3' },
  { id: 'llama3.2-3b', name: 'Llama 3.2 3B', quant: 'Q4_K_M', sizeMB: 2015, description: 'Full Llama 3.2 experience. Excellent quality.', url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf', filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf', template: 'llama3' },
  { id: 'gemma-2b', name: 'Gemma 2 2B', quant: 'Q4_K_M', sizeMB: 1600, description: "Google's efficient model. Good reasoning.", url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf', filename: 'gemma-2-2b-it-Q4_K_M.gguf', template: 'gemma' },
  { id: 'phi-2.7b', name: 'Phi-2 2.7B', quant: 'Q4_K_M', sizeMB: 1800, description: "Microsoft's reasoning model. Surprisingly capable.", url: 'https://huggingface.co/bartowski/Phi-2-GGUF/resolve/main/Phi-2-Q4_K_M.gguf', filename: 'Phi-2-Q4_K_M.gguf', template: 'phi' },
];

export const WHISPER_CATALOG: WhisperModelInfo[] = [
  { id: 'whisper-tiny', name: 'Tiny (English)', sizeMB: 42, description: 'Fastest. Decent accuracy.', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q8_0.bin', filename: 'ggml-tiny.en-q8_0.bin' },
  { id: 'whisper-base', name: 'Base (English)', sizeMB: 78, description: 'Best balance. Recommended.', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q8_0.bin', filename: 'ggml-base.en-q8_0.bin' },
  { id: 'whisper-small', name: 'Small (English)', sizeMB: 300, description: 'Highest accuracy. Slower.', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q8_0.bin', filename: 'ggml-small.en-q8_0.bin' },
];

export const SYSTEM_PROMPT_DEFAULT = 'You are Kvak, a helpful AI running on-device.';

// Small on-device embedding models for full RAG (llama.cpp embed support)
// Use GGUF embed models compatible with llama (e.g. nomic, arctic, etc. with --pooling mean)
export const EMBED_CATALOG: ModelInfo[] = [
  { id: 'nomic-embed', name: 'Nomic Embed Text v1.5', quant: 'Q4_K_M', sizeMB: 70, description: 'Small, fast on-device embeddings (768 dim). Recommended for RAG.', url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf', filename: 'nomic-embed-text-v1.5.Q4_K_M.gguf', template: 'nomic' },
];
