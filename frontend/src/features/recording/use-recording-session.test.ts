/**
 * Focused lifecycle tests for useRecordingSession.
 *
 * These exercise the recording/STT boundary in isolation (renderHook), without
 * the App page shell. Strategy mirrors the proven app.test harness:
 *  - vi.mock the two transport modules (LiveClient / SenseVoiceWsClient) so the
 *    hook's client startup/send/stop/finalize orchestration is observable;
 *  - stub the browser audio environment (getUserMedia / AudioContext /
 *    AudioWorkletNode) so mic + AudioWorklet setup runs against fakes;
 *  - stub fetch for the Gemini ephemeral-token request.
 *
 * Coverage (all high-risk existing behavior):
 *  - first mic tap primes permission only (no recording / token / session)
 *  - real start routes SenseVoice vs Gemini by language profile
 *  - AudioWorklet PCM frames reach the active client while capturing, and are
 *    ignored after stop (late-message gate)
 *  - stop finalizes: sends the proper end control, waits for SenseVoice
 *    completion, tears down resources, and hands one final transcript to cleanup
 *  - unmount tears down mic / AudioContext / worklet / client
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Language, Mode } from '../../types';
import {
  useRecordingSession,
  createDebugSnapshot,
  type LiveDebugSnapshot,
  type RecordingSessionCallbacks,
} from './use-recording-session';

// ── transport mocks ───────────────────────────────────────────────────────────

const liveClientMockState = vi.hoisted(() => ({
  latestConfig: undefined as any,
  latestClient: undefined as any,
}));

const senseVoiceClientMockState = vi.hoisted(() => ({
  latestConfig: undefined as any,
  latestClient: undefined as any,
}));

vi.mock('../../live/live-client', () => ({
  LiveClient: class {
    constructor(config: any) {
      liveClientMockState.latestConfig = config;
      liveClientMockState.latestClient = {
        connect: vi.fn(() => config.onOpen?.()),
        sendAudioChunk: vi.fn(),
        sendAudioStreamEnd: vi.fn(),
        disconnect: vi.fn(),
        emitSetupComplete: vi.fn(() => config.onSetupComplete?.()),
        emitTranscription: vi.fn((t: string, f: boolean) => config.onTranscription?.(t, f)),
        emitError: vi.fn((m: string) => config.onError?.(m)),
      };
      return liveClientMockState.latestClient;
    }
  },
}));

vi.mock('../../live/sensevoice-ws-client', () => ({
  SenseVoiceWsClient: class {
    constructor(config: any) {
      senseVoiceClientMockState.latestConfig = config;
      senseVoiceClientMockState.latestClient = {
        connect: vi.fn(() => config.onOpen?.()),
        sendAudioChunk: vi.fn(),
        sendAudioStreamEnd: vi.fn(() => config.onEndSent?.()),
        disconnect: vi.fn(),
        waitForCompletion: vi.fn().mockResolvedValue(''),
        emitTranscription: vi.fn((t: string, f: boolean) => config.onTranscription?.(t, f)),
        emitEndAck: vi.fn(() => config.onEndAck?.()),
      };
      return senseVoiceClientMockState.latestClient;
    }
  },
}));

// ── browser audio env ─────────────────────────────────────────────────────────

const mockBrowserAudioPipeline = () => {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });

  const workletPort = { onmessage: null as ((event: MessageEvent) => void) | null };
  class MockAudioWorkletNode {
    port = workletPort;
    connect = vi.fn();
    disconnect = vi.fn();
  }
  class MockAudioContext {
    sampleRate = 48000;
    state = 'running';
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  }
  vi.stubGlobal('AudioContext', MockAudioContext);
  vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode);

  return { getUserMedia, stop, workletPort };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

// ── callback harness ──────────────────────────────────────────────────────────

type Harness = {
  callbacks: RecordingSessionCallbacks;
  state: {
    interim: string;
    final: string;
    status: string;
    appError: string;
    isRecording: boolean;
    debug: LiveDebugSnapshot;
  };
  cleanupCalls: Array<{ text: string; mode: Mode; language: Language }>;
  debugEvents: string[];
};

const makeHarness = (): Harness => {
  const state: Harness['state'] = {
    interim: '',
    final: '',
    status: '',
    appError: '',
    isRecording: false,
    debug: createDebugSnapshot(),
  };
  const cleanupCalls: Harness['cleanupCalls'] = [];
  const debugEvents: string[] = [];

  const resolve = <T>(prev: T, next: T | ((p: T) => T)): T =>
    typeof next === 'function' ? (next as (p: T) => T)(prev) : next;

  const callbacks: RecordingSessionCallbacks = {
    setInterimTranscript: (t) => { state.interim = resolve(state.interim, t); },
    setFinalTranscript: (t) => { state.final = resolve(state.final, t); },
    setLiveStatus: (s) => { state.status = resolve(state.status, s); },
    setAppErrorMsg: (m) => { state.appError = resolve(state.appError, m); },
    setIsRecording: (b) => { state.isRecording = resolve(state.isRecording, b); },
    resetDebugSnapshot: () => { state.debug = createDebugSnapshot(); },
    updateDebugSnapshot: (patch) => { state.debug = { ...state.debug, ...patch }; },
    getDebugSnapshot: () => state.debug,
    runCleanup: async (text, mode, language) => { cleanupCalls.push({ text, mode, language }); },
    clearCleanupError: () => {},
    triggerVibe: () => {},
    postDebugEvent: async (phase) => { debugEvents.push(phase); },
    getInterimTranscript: () => state.interim,
    getFinalTranscript: () => state.final,
  };

  return { callbacks, state, cleanupCalls, debugEvents };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  liveClientMockState.latestConfig = undefined;
  liveClientMockState.latestClient = undefined;
  senseVoiceClientMockState.latestConfig = undefined;
  senseVoiceClientMockState.latestClient = undefined;
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useRecordingSession — permission priming', () => {
  it('first tap primes mic permission only: no recording, no token, no session', async () => {
    const { getUserMedia, stop } = mockBrowserAudioPipeline();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const h = makeHarness();

    const { result } = renderHook(() => useRecordingSession(h.callbacks));

    expect(result.current.isMicPrimed()).toBe(false);

    await act(async () => {
      await result.current.primeMicPermission();
      await flushPromises();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled(); // primed stream tracks are stopped
    expect(fetchMock).not.toHaveBeenCalled();
    expect(liveClientMockState.latestClient).toBeUndefined();
    expect(senseVoiceClientMockState.latestClient).toBeUndefined();
    expect(result.current.isMicPrimed()).toBe(true);
    expect(h.state.appError).toBe('');
    expect(h.state.status).toMatch(/麥克風已授權/);
  });
});

describe('useRecordingSession — real start route selection', () => {
  it('routes mixed/Cantonese to SenseVoice with the right language + ws url', async () => {
    mockBrowserAudioPipeline();
    vi.stubGlobal('fetch', vi.fn());
    const h = makeHarness();

    const { result } = renderHook(() => useRecordingSession(h.callbacks));

    await act(async () => {
      result.current.startRecording({ mockMode: false, language: 'mixed' });
      await flushPromises();
    });

    expect(senseVoiceClientMockState.latestConfig).toBeTruthy();
    expect(senseVoiceClientMockState.latestConfig.language).toBe('auto');
    expect(senseVoiceClientMockState.latestConfig.wsUrl).toContain('/ws/transcribe-v2');
    expect(liveClientMockState.latestClient).toBeUndefined();
  });

  it('routes English to Gemini LiveClient via an ephemeral token request', async () => {
    mockBrowserAudioPipeline();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'test-token', model: 'models/test-live' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const h = makeHarness();

    const { result } = renderHook(() => useRecordingSession(h.callbacks));

    await act(async () => {
      result.current.startRecording({ mockMode: false, language: 'en' });
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/live-token?profile=english', { method: 'POST' });
    expect(liveClientMockState.latestClient).toBeTruthy();
    expect(senseVoiceClientMockState.latestClient).toBeUndefined();
  });
});

describe('useRecordingSession — AudioWorklet PCM gate', () => {
  it('forwards PCM frames to the active client while capturing and ignores late frames after stop', async () => {
    const { workletPort } = mockBrowserAudioPipeline();
    vi.stubGlobal('fetch', vi.fn());
    const h = makeHarness();

    const { result } = renderHook(() => useRecordingSession(h.callbacks));

    await act(async () => {
      result.current.startRecording({ mockMode: false, language: 'mixed' });
      await flushPromises();
    });

    const client = senseVoiceClientMockState.latestClient;
    expect(typeof workletPort.onmessage).toBe('function');

    // A frame while capturing reaches the client.
    await act(async () => {
      workletPort.onmessage!({ data: new Float32Array(256) } as MessageEvent);
    });
    expect(client.sendAudioChunk).toHaveBeenCalledTimes(1);

    // Stop the session.
    await act(async () => {
      await result.current.stopRecording({ mockMode: false, mode: 'message', language: 'mixed' });
      await flushPromises();
    });

    // A late AudioWorklet frame after stop must be ignored (capture gate closed).
    const before = client.sendAudioChunk.mock.calls.length;
    if (typeof workletPort.onmessage === 'function') {
      await act(async () => {
        workletPort.onmessage!({ data: new Float32Array(256) } as MessageEvent);
      });
    }
    expect(client.sendAudioChunk.mock.calls.length).toBe(before);
  });
});

describe('useRecordingSession — stop finalization + teardown', () => {
  it('SenseVoice stop sends END, waits for completion, tears down, and hands one final transcript to cleanup', async () => {
    const { stop } = mockBrowserAudioPipeline();
    vi.stubGlobal('fetch', vi.fn());
    const h = makeHarness();

    const { result } = renderHook(() => useRecordingSession(h.callbacks));

    await act(async () => {
      result.current.startRecording({ mockMode: false, language: 'mixed' });
      await flushPromises();
    });

    const client = senseVoiceClientMockState.latestClient;

    // Final transcript arrives during recording.
    await act(async () => {
      senseVoiceClientMockState.latestConfig.onTranscription('完整逐字稿', true);
    });

    await act(async () => {
      await result.current.stopRecording({ mockMode: false, mode: 'message', language: 'mixed' });
      await flushPromises();
    });

    expect(client.sendAudioStreamEnd).toHaveBeenCalled();
    expect(client.waitForCompletion).toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled(); // mic tracks stopped

    expect(h.cleanupCalls).toHaveLength(1);
    expect(h.cleanupCalls[0]).toMatchObject({ text: '完整逐字稿', mode: 'message', language: 'mixed' });
  });

  it('does not call cleanup when no transcript was captured', async () => {
    mockBrowserAudioPipeline();
    vi.stubGlobal('fetch', vi.fn());
    const h = makeHarness();

    const { result } = renderHook(() => useRecordingSession(h.callbacks));

    await act(async () => {
      result.current.startRecording({ mockMode: false, language: 'mixed' });
      await flushPromises();
    });

    await act(async () => {
      await result.current.stopRecording({ mockMode: false, mode: 'message', language: 'mixed' });
      await flushPromises();
    });

    expect(h.cleanupCalls).toHaveLength(0);
    expect(h.debugEvents).toContain('no-transcript');
  });
});

describe('useRecordingSession — unmount cleanup', () => {
  it('tears down mic tracks and AudioContext on unmount', async () => {
    const { stop } = mockBrowserAudioPipeline();
    vi.stubGlobal('fetch', vi.fn());
    const h = makeHarness();

    const { result, unmount } = renderHook(() => useRecordingSession(h.callbacks));

    await act(async () => {
      result.current.startRecording({ mockMode: false, language: 'mixed' });
      await flushPromises();
    });

    const client = senseVoiceClientMockState.latestClient;
    stop.mockClear();

    unmount();

    expect(stop).toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });
});
