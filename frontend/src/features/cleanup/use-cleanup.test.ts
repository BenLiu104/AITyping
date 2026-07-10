/**
 * Focused unit tests for useCleanup hook and cleanup-api functions.
 *
 * Strategy: mock fetch at the HTTP boundary; no AudioContext, WebSocket, or
 * browser audio mock needed here. Tests cover:
 *  - standard vs semantic endpoint routing
 *  - request body shape
 *  - stale-response protection (runId guard)
 *  - mode re-run behavior
 *  - re-run failure preserves previous cleaned result
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCleanup } from './use-cleanup';
import { callCleanupAPI, callSmartCleanupAPI, callCleanupForMode } from './cleanup-api';

// ── helpers ──────────────────────────────────────────────────────────────────

type FetchMock = ReturnType<typeof vi.fn>;

const makeFetchMock = (responses: Array<{ ok: boolean; body: unknown }>): FetchMock => {
  let idx = 0;
  const mock = vi.fn().mockImplementation(() => {
    const resp = responses[idx++] ?? { ok: true, body: {} };
    return Promise.resolve({
      ok: resp.ok,
      json: async () => resp.body,
    });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── cleanup-api unit tests ────────────────────────────────────────────────────

describe('callCleanupAPI', () => {
  it('POSTs to /api/cleanup with the correct body shape and returns cleaned', async () => {
    const fetchMock = makeFetchMock([
      { ok: true, body: { cleaned: 'polished text', mode: 'message' } },
    ]);

    const result = await callCleanupAPI('raw text', 'message', 'mixed');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cleanup',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      rawTranscript: 'raw text',
      mode: 'message',
      language: 'mixed',
      style: 'natural',
    });
    expect(result.cleanedText).toBe('polished text');
  });

  it('throws with the expected message when response is not ok', async () => {
    makeFetchMock([{ ok: false, body: {} }]);
    await expect(callCleanupAPI('raw', 'message', 'mixed')).rejects.toThrow('Cleanup API 呼叫失敗');
  });
});

describe('callSmartCleanupAPI', () => {
  it('POSTs to /api/smart-cleanup and extracts clean_text only', async () => {
    const fetchMock = makeFetchMock([
      {
        ok: true,
        body: {
          clean_text: '智能整理結果',
          intent_status: 'decided',
          reasoning_summary: '...',
          confidence: 0.9,
        },
      },
    ]);

    const result = await callSmartCleanupAPI('逐字稿', 'yue');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/smart-cleanup',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ transcript: '逐字稿', languageMode: 'yue' });
    expect(result.cleanedText).toBe('智能整理結果');
  });

  it('throws with the expected message when response is not ok', async () => {
    makeFetchMock([{ ok: false, body: {} }]);
    await expect(callSmartCleanupAPI('t', 'en')).rejects.toThrow('Smart Cleanup API 呼叫失敗');
  });
});

describe('callCleanupForMode routing', () => {
  it('routes semantic mode to /api/smart-cleanup', async () => {
    const fetchMock = makeFetchMock([
      { ok: true, body: { clean_text: 'smart', intent_status: 'decided', reasoning_summary: '', confidence: 1 } },
    ]);
    await callCleanupForMode('text', 'semantic', 'zh-Hant');
    expect(fetchMock).toHaveBeenCalledWith('/api/smart-cleanup', expect.anything());
  });

  it('routes non-semantic modes to /api/cleanup', async () => {
    for (const mode of ['message', 'email', 'todo', 'prompt'] as const) {
      const fetchMock = makeFetchMock([{ ok: true, body: { cleaned: 'c', mode } }]);
      await callCleanupForMode('text', mode, 'en');
      expect(fetchMock).toHaveBeenCalledWith('/api/cleanup', expect.anything());
      vi.unstubAllGlobals();
    }
  });
});

// ── useCleanup hook tests ─────────────────────────────────────────────────────

describe('useCleanup — runCleanup (normal mode)', () => {
  it('sets cleanedText and clears loading on success', async () => {
    makeFetchMock([{ ok: true, body: { cleaned: '整理後', mode: 'message' } }]);
    const { result } = renderHook(() => useCleanup());

    await act(async () => {
      await result.current.runCleanup('raw', 'message', 'mixed');
    });

    expect(result.current.cleanedText).toBe('整理後');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.errorMsg).toBe('');
    expect(result.current.lastCleanedMode).toBe('message');
    expect(result.current.cleanupSourceTranscript).toBe('raw');
  });

  it('sets errorMsg on API failure, cleanedText stays empty', async () => {
    makeFetchMock([{ ok: false, body: {} }]);
    const { result } = renderHook(() => useCleanup());

    await act(async () => {
      await result.current.runCleanup('raw', 'email', 'en');
    });

    expect(result.current.cleanedText).toBe('');
    expect(result.current.errorMsg).toMatch(/Cleanup API 呼叫失敗/);
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useCleanup — runCleanup (semantic mode)', () => {
  it('calls /api/smart-cleanup and stores result', async () => {
    makeFetchMock([
      {
        ok: true,
        body: { clean_text: '語義整理', intent_status: 'decided', reasoning_summary: '', confidence: 1 },
      },
    ]);
    const { result } = renderHook(() => useCleanup());

    await act(async () => {
      await result.current.runCleanup('逐字稿', 'semantic', 'zh-Hant');
    });

    expect(result.current.cleanedText).toBe('語義整理');
    expect(result.current.lastCleanedMode).toBe('semantic');
  });
});

describe('useCleanup — stale response protection', () => {
  it('does not overwrite a newer run result with a stale response', async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstFetch = new Promise((resolve) => { resolveFirst = resolve; });

    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstFetch.then(() => ({
        ok: true,
        json: async () => ({ cleaned: '舊結果', mode: 'message' }),
      })))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: async () => ({ cleaned: '新結果', mode: 'todo' }),
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCleanup());

    // Start run #1 (slow — not resolved yet)
    let run1!: Promise<void>;
    act(() => {
      run1 = result.current.runCleanup('text', 'message', 'mixed');
    });

    // Start run #2 (fast)
    await act(async () => {
      await result.current.runCleanup('text', 'todo', 'mixed');
    });

    expect(result.current.cleanedText).toBe('新結果');

    // Now resolve the stale first fetch
    await act(async () => {
      resolveFirst(undefined);
      await run1;
    });

    // Stale run must NOT overwrite the newer result
    expect(result.current.cleanedText).toBe('新結果');
  });
});

describe('useCleanup — rerunCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupWithInitialCleanup = async (
    firstModeResponse: { ok: boolean; body: unknown },
  ) => {
    const fetchMock = makeFetchMock([firstModeResponse]);
    const { result } = renderHook(() => useCleanup());

    await act(async () => {
      await result.current.runCleanup('原始逐字稿', 'message', 'mixed');
    });

    return { result, fetchMock };
  };

  it('re-runs /api/cleanup when mode changes from message to todo', async () => {
    const { result, fetchMock } = await setupWithInitialCleanup({
      ok: true, body: { cleaned: '訊息結果', mode: 'message' },
    });

    // Add second response for re-run
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cleaned: '待辦結果', mode: 'todo' }),
    });

    await act(async () => {
      await result.current.rerunCleanup('todo', 'mixed', false);
    });

    const cleanupCalls = fetchMock.mock.calls.filter((args: unknown[]) => args[0] === '/api/cleanup');
    expect(cleanupCalls).toHaveLength(2);
    const rerunBody = JSON.parse((cleanupCalls[1][1] as RequestInit).body as string);
    expect(rerunBody).toMatchObject({ rawTranscript: '原始逐字稿', mode: 'todo', language: 'mixed' });
    expect(result.current.cleanedText).toBe('待辦結果');
  });

  it('re-runs /api/smart-cleanup when mode changes to semantic', async () => {
    const { result, fetchMock } = await setupWithInitialCleanup({
      ok: true, body: { cleaned: '訊息結果', mode: 'message' },
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clean_text: '智能結果', intent_status: 'decided', reasoning_summary: '', confidence: 1 }),
    });

    await act(async () => {
      await result.current.rerunCleanup('semantic', 'mixed', false);
    });

    const smartCalls = fetchMock.mock.calls.filter((args: unknown[]) => args[0] === '/api/smart-cleanup');
    expect(smartCalls).toHaveLength(1);
    expect(result.current.cleanedText).toBe('智能結果');
  });

  it('does NOT re-run when isRecording is true', async () => {
    const { result, fetchMock } = await setupWithInitialCleanup({
      ok: true, body: { cleaned: '訊息結果', mode: 'message' },
    });
    const callsBefore = fetchMock.mock.calls.length;

    await act(async () => {
      await result.current.rerunCleanup('todo', 'mixed', true /* isRecording */);
    });

    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('does NOT re-run when sourceTranscript is empty', async () => {
    const fetchMock = makeFetchMock([]);
    const { result } = renderHook(() => useCleanup());

    await act(async () => {
      await result.current.rerunCleanup('todo', 'mixed', false);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves previous cleaned result when re-run fails', async () => {
    const { result, fetchMock } = await setupWithInitialCleanup({
      ok: true, body: { cleaned: '原本整理結果', mode: 'message' },
    });

    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    await act(async () => {
      await result.current.rerunCleanup('todo', 'mixed', false);
    });

    // Cleaned text must remain the previous successful result
    expect(result.current.cleanedText).toBe('原本整理結果');
    expect(result.current.errorMsg).toMatch(/Cleanup API 呼叫失敗/);
  });
});

describe('useCleanup — resetCleanup', () => {
  it('clears all cleanup state', async () => {
    makeFetchMock([{ ok: true, body: { cleaned: '整理後', mode: 'message' } }]);
    const { result } = renderHook(() => useCleanup());

    await act(async () => {
      await result.current.runCleanup('raw', 'message', 'mixed');
    });
    expect(result.current.cleanedText).toBe('整理後');

    act(() => result.current.resetCleanup());

    expect(result.current.cleanedText).toBe('');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.errorMsg).toBe('');
    expect(result.current.cleanupSourceTranscript).toBe('');
    expect(result.current.lastCleanedMode).toBeNull();
  });
});

// ── AbortController lifecycle tests (Task 6 repair) ───────────────────────────
//
// A manual fetch mock that (a) records the AbortSignal it was handed and
// (b) rejects with an AbortError the moment that signal fires, mirroring the
// real fetch contract. This lets us assert the hook aborts prior/active
// requests and never mutates cleanup state after cancellation.

type ManualCall = {
  url: string;
  signal: AbortSignal | undefined;
  resolve: (body: unknown) => void;
};

const makeManualFetch = (): { mock: FetchMock; calls: ManualCall[] } => {
  const calls: ManualCall[] = [];
  const mock = vi.fn((url: string, init?: RequestInit) => {
    let resolveFn!: (v: unknown) => void;
    let rejectFn!: (e: unknown) => void;
    const p = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    const signal = init?.signal ?? undefined;
    if (signal) {
      signal.addEventListener('abort', () => {
        rejectFn(new DOMException('Aborted', 'AbortError'));
      });
    }
    calls.push({
      url,
      signal,
      resolve: (body: unknown) => resolveFn({ ok: true, json: async () => body }),
    });
    return p;
  });
  vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  return { mock, calls };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useCleanup — AbortController lifecycle', () => {
  it('aborts the prior in-flight request when a newer run starts', async () => {
    const { calls } = makeManualFetch();
    const { result } = renderHook(() => useCleanup());

    act(() => {
      void result.current.runCleanup('t', 'message', 'mixed');
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].signal?.aborted).toBe(false);

    act(() => {
      void result.current.runCleanup('t', 'todo', 'mixed');
    });

    // Prior request's signal must be aborted; a fresh request started.
    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].signal?.aborted).toBe(false);
  });

  it('resetCleanup aborts the active request and does not mutate state afterward', async () => {
    const { calls } = makeManualFetch();
    const { result } = renderHook(() => useCleanup());

    act(() => {
      void result.current.runCleanup('t', 'message', 'mixed');
    });
    expect(calls[0].signal?.aborted).toBe(false);

    act(() => result.current.resetCleanup());
    expect(calls[0].signal?.aborted).toBe(true);

    // Late resolution of the aborted request must not set result/error/loading.
    await act(async () => {
      calls[0].resolve({ cleaned: '遲來結果', mode: 'message' });
      await flush();
    });

    expect(result.current.cleanedText).toBe('');
    expect(result.current.errorMsg).toBe('');
    expect(result.current.isLoading).toBe(false);
  });

  it('aborts the active request on unmount', async () => {
    const { calls } = makeManualFetch();
    const { result, unmount } = renderHook(() => useCleanup());

    act(() => {
      void result.current.runCleanup('t', 'message', 'mixed');
    });
    expect(calls[0].signal?.aborted).toBe(false);

    unmount();
    expect(calls[0].signal?.aborted).toBe(true);
  });

  it('does not set errorMsg when a request is aborted mid-flight', async () => {
    makeManualFetch();
    const { result } = renderHook(() => useCleanup());

    let run1!: Promise<void>;
    act(() => {
      run1 = result.current.runCleanup('t', 'message', 'mixed');
    });

    // Newer run supersedes and aborts run #1.
    act(() => {
      void result.current.runCleanup('t', 'todo', 'mixed');
    });

    await act(async () => {
      await run1; // aborted → rejects internally, must be swallowed
      await flush();
    });

    expect(result.current.errorMsg).toBe('');
  });
});

describe('useCleanup — mock guard equivalence', () => {
  it('rerunCleanup uses injected mockCleanup only (no mockMode arg, no fetch)', async () => {
    const mockCleanup = vi.fn(
      (text: string, mode: string) => `MOCK:${mode}:${text}`,
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { result } = renderHook(() => useCleanup({ mockCleanup }));

    // Seed an initial cleanup (mock path — no fetch).
    await act(async () => {
      await result.current.runCleanup('原始逐字稿', 'message', 'mixed');
    });
    expect(result.current.cleanedText).toBe('MOCK:message:原始逐字稿');

    // Re-run with the NEW 3-arg signature (nextMode, language, isRecording).
    await act(async () => {
      await result.current.rerunCleanup('todo', 'mixed', false);
    });

    expect(result.current.cleanedText).toBe('MOCK:todo:原始逐字稿');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rerunCleanup hits the HTTP boundary when no mockCleanup is injected', async () => {
    const fetchMock = makeFetchMock([
      { ok: true, body: { cleaned: '訊息結果', mode: 'message' } },
      { ok: true, body: { cleaned: '待辦結果', mode: 'todo' } },
    ]);
    const { result } = renderHook(() => useCleanup());

    await act(async () => {
      await result.current.runCleanup('原始逐字稿', 'message', 'mixed');
    });

    await act(async () => {
      await result.current.rerunCleanup('todo', 'mixed', false);
    });

    const cleanupCalls = fetchMock.mock.calls.filter(
      (args: unknown[]) => args[0] === '/api/cleanup',
    );
    expect(cleanupCalls).toHaveLength(2);
    expect(result.current.cleanedText).toBe('待辦結果');
  });
});
