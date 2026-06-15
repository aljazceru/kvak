/**
 * Mango × QVAC — Chat templates
 * Converts message arrays into model-specific prompt strings.
 */
import type { Message } from '../types';

type TemplateFn = (role: string, content: string) => string;

const TEMPLATES: Record<string, { msg: TemplateFn; suffix: string }> = {
  llama3: {
    msg: (r, c) =>
      r === 'user' ? `<|start_header_id|>user<|end_header_id|>\n\n${c}<|eot_id|>`
      : r === 'assistant' ? `<|start_header_id|>assistant<|end_header_id|>\n\n${c}<|eot_id|>`
      : `<|start_header_id|>system<|end_header_id|>\n\n${c}<|eot_id|>`,
    suffix: '<|start_header_id|>assistant<|end_header_id|>\n',
  },
  qwen: {
    msg: (r, c) =>
      r === 'user' ? `<|im_start|>user\n${c}<|im_end|>`
      : r === 'assistant' ? `<|im_start|>assistant\n${c}<|im_end|>`
      : `<|im_start|>system\n${c}<|im_end|>`,
    suffix: '<|im_start|>assistant\n',
  },
  phi: {
    msg: (r, c) =>
      r === 'user' ? `Instruct: ${c}\n`
      : r === 'assistant' ? `Output: ${c}\n`
      : `${c}\n`,
    suffix: '',
  },
  gemma: {
    msg: (r, c) =>
      r === 'user' ? `<start_of_turn>user\n${c}<end_of_turn>\n`
      : r === 'assistant' ? `<start_of_turn>model\n${c}<end_of_turn>\n`
      : '',
    suffix: '<start_of_turn>model\n',
  },
  simple: {
    msg: (r, c) => `${r}: ${c}\n`,
    suffix: '',
  },
};

export function buildPrompt(messages: Message[], template: string): string {
  const t = TEMPLATES[template] || TEMPLATES.simple;
  return messages.map(m => t.msg(m.role, m.content)).join('') + t.suffix;
}
