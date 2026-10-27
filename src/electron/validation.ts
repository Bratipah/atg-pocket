import type { ExplanationRequest } from './api.js';

export const MAX_CONTEXT_LENGTH = 1600;
export const MAX_ANSWER_LENGTH = 1800;

export function validateExplanationInput(value: unknown): ExplanationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter a treasury context.');
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'context') throw new Error('Invalid explanation request.');
  const context = (value as Record<string, unknown>).context;
  if (typeof context !== 'string' || context.trim().length < 8 || context.length > MAX_CONTEXT_LENGTH) {
    throw new Error(`Context must be 8 to ${MAX_CONTEXT_LENGTH} characters.`);
  }
  return { context: context.trim() };
}

export function validateModelAnswer(answer: unknown): string {
  if (typeof answer !== 'string') throw new Error('The local model returned an invalid response.');
  const cleaned = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!cleaned || cleaned.length > MAX_ANSWER_LENGTH) throw new Error('The local model response was empty or too long.');
  return cleaned;
}
