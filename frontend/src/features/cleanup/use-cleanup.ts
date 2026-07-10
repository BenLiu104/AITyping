/**
 * useCleanup — manages cleanup request lifecycle.
 *
 * Owns:
 *  - cleanedText / isLoading / errorMsg state for the cleanup card
 *  - monotonically-increasing runId for stale-response protection
 *  - post-stop cleanup execution (runCleanup)
 *  - mode-change re-run (rerunCleanup)
 *
 * Does NOT own: transcript state, recording lifecycle, AudioWorklet, UI JSX.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Mode, Language } from '../../types';
import { callCleanupForMode } from './cleanup-api';

export interface UseCleanupOptions {
  mockCleanup?: (text: string, mode: Mode, language: Language) => string;
}

export interface UseCleanupResult {
  cleanedText: string;
  isLoading: boolean;
  errorMsg: string;
  /** Source transcript that produced the last cleanup result (for re-run). */
  cleanupSourceTranscript: string;
  lastCleanedMode: Mode | null;
  lastCleanedLanguage: Language | null;
  /** Run cleanup for a fresh transcript (called after stop). */
  runCleanup: (text: string, mode: Mode, language: Language) => Promise<void>;
  /** Re-run cleanup after mode/language change (uses saved source transcript). */
  rerunCleanup: (
    nextMode: Mode,
    language: Language,
    isRecording: boolean,
  ) => Promise<void>;
  /** Imperatively set cleanedText (e.g. user types into textarea). */
  setCleanedText: (text: string) => void;
  /** Clear error (e.g. user taps ✕). */
  clearError: () => void;
  /** Reset all cleanup state on new recording start or reset. */
  resetCleanup: () => void;
}

/** True when an error is the browser's fetch-abort signal, which must be swallowed. */
const isAbortError = (err: unknown): boolean =>
  err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError';

export function useCleanup({ mockCleanup }: UseCleanupOptions = {}): UseCleanupResult {
  const [cleanedText, setCleanedText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [cleanupSourceTranscript, setCleanupSourceTranscript] = useState<string>('');
  const [lastCleanedMode, setLastCleanedMode] = useState<Mode | null>(null);
  const [lastCleanedLanguage, setLastCleanedLanguage] = useState<Language | null>(null);

  const runIdRef = useRef<number>(0);
  // Tracks the AbortController of the currently in-flight cleanup request so a
  // newer run / reset / unmount can cancel it. Kept in a ref, never exposed to App.
  const activeControllerRef = useRef<AbortController | null>(null);

  /** Abort any in-flight cleanup request and forget its controller. */
  const abortActive = useCallback(() => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
  }, []);

  // Abort a lingering request if the component unmounts.
  useEffect(() => () => abortActive(), [abortActive]);

  const runCleanup = useCallback(
    async (text: string, mode: Mode, language: Language): Promise<void> => {
      // Cancel any prior request before starting a newer one.
      abortActive();
      const controller = new AbortController();
      activeControllerRef.current = controller;

      const runId = ++runIdRef.current;
      setCleanupSourceTranscript(text);
      setIsLoading(true);
      setErrorMsg('');

      try {
        let cleanedResult: string;
        if (mockCleanup) {
          cleanedResult = mockCleanup(text, mode, language);
        } else {
          const result = await callCleanupForMode(text, mode, language, controller.signal);
          cleanedResult = result.cleanedText;
        }
        if (runId !== runIdRef.current) return;
        setCleanedText(cleanedResult);
        setLastCleanedMode(mode);
        setLastCleanedLanguage(language);
      } catch (err: unknown) {
        // Aborted requests are cancellations, not failures — never surface them.
        if (isAbortError(err) || runId !== runIdRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : '整理失敗，請再試一次');
      } finally {
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
        if (runIdRef.current === runId) {
          setIsLoading(false);
        }
      }
    },
    [mockCleanup, abortActive],
  );

  const rerunCleanup = useCallback(
    async (
      nextMode: Mode,
      language: Language,
      isRecording: boolean,
    ): Promise<void> => {
      if (isRecording) return;
      if (!cleanupSourceTranscript.trim()) return;
      if (cleanedText && nextMode === lastCleanedMode && language === lastCleanedLanguage) return;

      // Re-run shares runCleanup's lifecycle (abort policy + mock guard) so the
      // mock/HTTP decision lives in exactly one place.
      await runCleanup(cleanupSourceTranscript, nextMode, language);
    },
    [cleanupSourceTranscript, cleanedText, lastCleanedMode, lastCleanedLanguage, runCleanup],
  );

  const clearError = useCallback(() => setErrorMsg(''), []);

  const resetCleanup = useCallback(() => {
    abortActive();
    runIdRef.current++;
    setCleanedText('');
    setIsLoading(false);
    setErrorMsg('');
    setCleanupSourceTranscript('');
    setLastCleanedMode(null);
    setLastCleanedLanguage(null);
  }, [abortActive]);

  return {
    cleanedText,
    isLoading,
    errorMsg,
    cleanupSourceTranscript,
    lastCleanedMode,
    lastCleanedLanguage,
    runCleanup,
    rerunCleanup,
    setCleanedText,
    clearError,
    resetCleanup,
  };
}
