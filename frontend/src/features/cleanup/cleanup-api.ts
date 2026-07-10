/**
 * Typed HTTP boundary for cleanup endpoints.
 * All fetch I/O is here; App and useCleanup never parse raw responses.
 */

import type { Mode, Language } from '../../types';

// ── Response shapes ──────────────────────────────────────────────────────────

export interface CleanupResponse {
  cleaned: string;
  mode: string;
}

export interface SmartCleanupResponse {
  clean_text: string;
  intent_status: string;
  reasoning_summary: string;
  confidence: number;
}

// ── Normalised result ────────────────────────────────────────────────────────

/** The single string that App renders in the cleanup result card. */
export interface CleanupResult {
  cleanedText: string;
}

// ── API functions ─────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export async function callCleanupAPI(
  text: string,
  targetMode: Exclude<Mode, 'semantic'>,
  targetLanguage: Language,
  signal?: AbortSignal,
): Promise<CleanupResult> {
  const res = await fetch(`${API_BASE}/api/cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rawTranscript: text,
      mode: targetMode,
      language: targetLanguage,
      style: 'natural',
    }),
    signal,
  });
  if (!res.ok) throw new Error('Cleanup API 呼叫失敗');
  const data = (await res.json()) as CleanupResponse;
  return { cleanedText: data.cleaned };
}

export async function callSmartCleanupAPI(
  text: string,
  targetLanguage: Language,
  signal?: AbortSignal,
): Promise<CleanupResult> {
  const res = await fetch(`${API_BASE}/api/smart-cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: text,
      languageMode: targetLanguage,
    }),
    signal,
  });
  if (!res.ok) throw new Error('Smart Cleanup API 呼叫失敗');
  const data = (await res.json()) as SmartCleanupResponse;
  return { cleanedText: data.clean_text };
}

export function callCleanupForMode(
  text: string,
  mode: Mode,
  language: Language,
  signal?: AbortSignal,
): Promise<CleanupResult> {
  return mode === 'semantic'
    ? callSmartCleanupAPI(text, language, signal)
    : callCleanupAPI(text, mode, language, signal);
}
