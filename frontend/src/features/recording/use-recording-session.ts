/**
 * useRecordingSession — sole owner of the microphone / AudioWorklet / STT
 * recording lifecycle extracted from App.tsx.
 *
 * Owns:
 *  - iOS first-tap mic permission priming
 *  - getUserMedia lifecycle + stream/track cleanup
 *  - AudioContext / AudioWorklet creation and teardown
 *  - active-capture gate (late AudioWorklet messages ignored after stop)
 *  - mock vs real session selection
 *  - LiveClient (Gemini) vs SenseVoiceWsClient route selection by language
 *  - client startup / send / stop / finalize / teardown orchestration
 *  - unmount resource cleanup
 *
 * Does NOT own (App keeps these): UI JSX, transcript/error/status/debug React
 * state, cleanup-feature integration. The hook drives them through the typed
 * callback contract below — it never reads the DOM or a global store.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Language, Mode } from '../../types';
import { resampleTo16k, floatTo16BitPCM } from '../../audio/converter';
import { LiveClient, type SpeechProfile } from '../../live/live-client';
import { SenseVoiceWsClient } from '../../live/sensevoice-ws-client';

// API base URL: 在 GitHub Pages 上指向 VPS backend，local dev 則用空字串走同源
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

// SenseVoice WebSocket endpoint（廣東話 STT）。由 build-time env 注入，
// 未設定時 fallback 去同源 /ws（local dev 用）。
const SENSEVOICE_WS_URL =
  import.meta.env.VITE_SENSEVOICE_WS_URL ||
  (typeof window !== 'undefined'
    ? `${window.location.origin.replace(/^http/, 'ws')}/ws/transcribe-v2`
    : '');

const getSpeechProfile = (language: Language): SpeechProfile => {
  if (language === 'mixed') return 'cantonese-english';
  if (language === 'yue') return 'cantonese';
  if (language === 'en') return 'english';
  return 'auto';
};

const getSenseVoiceLanguage = (language: Language): string => {
  if (language === 'mixed') return 'auto';
  if (language === 'yue') return 'yue';
  if (language === 'en') return 'en';
  return 'zh';
};

/** True when the current language uses the SenseVoice transport. */
const usesSenseVoice = (language: Language): boolean =>
  language === 'yue' || language === 'mixed';

// ── Debug snapshot (recording telemetry surfaced by App's debug row) ───────────

export type LiveDebugSnapshot = {
  wsOpen: boolean;
  setupComplete: boolean;
  audioChunks: number;
  audioBytes: number;
  audioSent: number;
  transcriptEvents: number;
  streamEndSent: boolean;
  streamEndAck: boolean;
  lastCloseCode?: number;
  lastCloseReason: string;
  lastError: string;
};

export const createDebugSnapshot = (): LiveDebugSnapshot => ({
  wsOpen: false,
  setupComplete: false,
  audioChunks: 0,
  audioBytes: 0,
  audioSent: 0,
  transcriptEvents: 0,
  streamEndSent: false,
  streamEndAck: false,
  lastCloseReason: '',
  lastError: '',
});

// ── Callback contract (App-owned state/effects the hook drives) ────────────────

export interface RecordingSessionCallbacks {
  setInterimTranscript: (value: string | ((prev: string) => string)) => void;
  setFinalTranscript: (value: string | ((prev: string) => string)) => void;
  setLiveStatus: (value: string) => void;
  setAppErrorMsg: (value: string) => void;
  setIsRecording: (value: boolean) => void;
  resetDebugSnapshot: () => void;
  updateDebugSnapshot: (patch: Partial<LiveDebugSnapshot>) => void;
  getDebugSnapshot: () => LiveDebugSnapshot;
  /** Hand the final transcript to the cleanup feature (useCleanup.runCleanup). */
  runCleanup: (text: string, mode: Mode, language: Language) => Promise<void>;
  /** Clear the cleanup-feature error before a fresh mock run. */
  clearCleanupError: () => void;
  triggerVibe: (ms: number) => void;
  /** Post a lifecycle debug event (telemetry; must never break recording). */
  postDebugEvent: (phase: string) => Promise<void>;
  /** Read App-owned interim transcript (stop-finalize fallback). */
  getInterimTranscript: () => string;
  /** Read App-owned final transcript (stop-finalize + mock cleanup source). */
  getFinalTranscript: () => string;
}

export interface StartRecordingArgs {
  mockMode: boolean;
  language: Language;
}

export interface StopRecordingArgs {
  mockMode: boolean;
  mode: Mode;
  language: Language;
}

export interface RecordingSession {
  /** iOS first-tap permission prime only — no recording/token/session. */
  primeMicPermission: () => Promise<void>;
  /** Begin capture (mock or real, routed by language). */
  startRecording: (args: StartRecordingArgs) => void;
  /** Stop capture, finalize, and hand transcript to cleanup. */
  stopRecording: (args: StopRecordingArgs) => Promise<void>;
  /** Whether mic permission is primed for this page session. */
  isMicPrimed: () => boolean;
}

export function useRecordingSession(callbacks: RecordingSessionCallbacks): RecordingSession {
  // Keep the latest callbacks in a ref so the returned actions are stable and
  // always call through to fresh App closures without re-creating handlers.
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  // Audio & WebSocket pipeline references.
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const liveClientRef = useRef<LiveClient | SenseVoiceWsClient | null>(null);
  const transcriptRef = useRef<string>('');
  const isPrimingMicPermissionRef = useRef<boolean>(false);
  const isMicPrimedForSessionRef = useRef<boolean>(false);
  const isCaptureActiveRef = useRef<boolean>(false);
  const mockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const requestMicStream = useCallback(
    () =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
    [],
  );

  const cleanupAudioPipeline = useCallback((disconnectLiveClient = true) => {
    isCaptureActiveRef.current = false;
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.onmessage = null;
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
    if (disconnectLiveClient && liveClientRef.current) {
      liveClientRef.current.disconnect();
      liveClientRef.current = null;
    }
  }, []);

  const waitForTranscript = useCallback(async (timeoutMs: number) => {
    const startedAt = Date.now();
    while (!transcriptRef.current.trim() && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, []);

  // ── permission priming ──────────────────────────────────────────────────────

  const primeMicPermission = useCallback(async () => {
    if (isPrimingMicPermissionRef.current) return;

    isPrimingMicPermissionRef.current = true;
    const cb = cbRef.current;
    cb.setAppErrorMsg('');
    cb.setLiveStatus('正在請求麥克風授權...');

    try {
      const stream = await requestMicStream();
      stream.getTracks().forEach((track) => track.stop());
      isMicPrimedForSessionRef.current = true;
      cb.setLiveStatus('麥克風已授權，請重新點一下開始錄音');
      cb.triggerVibe(30);
    } catch (err: unknown) {
      cb.setLiveStatus('');
      cb.setAppErrorMsg(
        err instanceof Error ? err.message : '麥克風授權失敗，請允許 Safari 使用麥克風',
      );
    } finally {
      isPrimingMicPermissionRef.current = false;
      cb.setIsRecording(false);
    }
  }, [requestMicStream]);

  // ── mock recording ──────────────────────────────────────────────────────────

  const startMockRecording = useCallback(() => {
    const cb = cbRef.current;
    cb.clearCleanupError();
    cb.setAppErrorMsg('');
    cb.setInterimTranscript('正在聽寫...');
    cb.setFinalTranscript('');

    const mockPhrases = [
      '今日天氣真係幾好啊 ',
      'by the way ',
      '聽日我哋幾點見面？ ',
      'let me check my calendar ',
      '唔好意思遲咗覆你。',
    ];
    let currentIdx = 0;

    mockIntervalRef.current = setInterval(() => {
      if (currentIdx < mockPhrases.length) {
        const nextPhrase = mockPhrases[currentIdx];
        cb.setInterimTranscript((prev) => prev + nextPhrase);
        cb.setFinalTranscript((prev) => prev + nextPhrase);
        cb.triggerVibe(10);
        currentIdx++;
      } else {
        if (mockIntervalRef.current) clearInterval(mockIntervalRef.current);
      }
    }, 1200);
  }, []);

  const stopMockRecording = useCallback(async (mode: Mode, language: Language) => {
    const cb = cbRef.current;
    if (mockIntervalRef.current) {
      clearInterval(mockIntervalRef.current);
    }
    cb.setInterimTranscript('');

    // Call Mock Cleanup or Real VPS /api/cleanup
    cb.triggerVibe(50);

    const textToClean =
      cb.getFinalTranscript() ||
      '今日天氣真係幾好啊 by the way 聽日我哋幾點見面？ let me check my calendar 唔好意思遲咗覆你。';

    await cb.runCleanup(textToClean, mode, language);
    cb.triggerVibe(40);
  }, []);

  // ── real recording ──────────────────────────────────────────────────────────

  const startRealRecording = useCallback(
    async (language: Language) => {
      const cb = cbRef.current;
      cb.clearCleanupError();
      cb.setAppErrorMsg('');
      cb.setLiveStatus('正在連線 Live API...');
      cb.resetDebugSnapshot();
      cb.setInterimTranscript('');
      cb.setFinalTranscript('');
      transcriptRef.current = '';

      try {
        // 1. Request mic permission first. iOS Safari is strict: getUserMedia must
        // stay directly inside the user gesture path, before unrelated awaits.
        const stream = await requestMicStream();
        mediaStreamRef.current = stream;
        isCaptureActiveRef.current = true;

        const useSenseVoice = usesSenseVoice(language);
        let audioContext: AudioContext;
        let client: LiveClient | SenseVoiceWsClient;
        let inputSampleRate: number;

        if (useSenseVoice) {
          // ── SenseVoice mode (Cantonese / mixed) — no ephemeral token needed ──
          cb.setLiveStatus('正在連線 SenseVoice...');

          audioContext = new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          audioContextRef.current = audioContext;
          if (audioContext.state === 'suspended') {
            await audioContext.resume();
          }
          inputSampleRate = audioContext.sampleRate;

          client = new SenseVoiceWsClient({
            wsUrl: SENSEVOICE_WS_URL,
            language: getSenseVoiceLanguage(language),
            onOpen: () => {
              cb.updateDebugSnapshot({ wsOpen: true });
              cb.setLiveStatus('SenseVoice 已就緒，請開始說話...');
            },
            onAudioSent: () => {
              cb.updateDebugSnapshot({ audioSent: cb.getDebugSnapshot().audioSent + 1 });
            },
            onEndSent: () => {
              cb.updateDebugSnapshot({ streamEndSent: true });
            },
            onEndAck: () => {
              cb.updateDebugSnapshot({ streamEndAck: true });
            },
            onTranscription: (text, isFinal) => {
              cb.updateDebugSnapshot({
                transcriptEvents: cb.getDebugSnapshot().transcriptEvents + 1,
              });
              cb.setLiveStatus('');
              if (isFinal) {
                transcriptRef.current += text;
                cb.setFinalTranscript(transcriptRef.current);
                cb.setInterimTranscript('');
              } else {
                cb.setInterimTranscript(text);
              }
            },
            onError: (err) => {
              cb.updateDebugSnapshot({ lastError: err });
              if (transcriptRef.current.trim() || cb.getDebugSnapshot().transcriptEvents > 0) {
                return;
              }
              cb.setAppErrorMsg(err);
              cleanupAudioPipeline();
              cb.setIsRecording(false);
            },
            onClose: (_code, _reason) => {
              cb.updateDebugSnapshot({ lastCloseCode: _code, lastCloseReason: _reason || '' });
              console.log('SenseVoice closed.');
            },
          });

          liveClientRef.current = client;
          client.connect();
        } else {
          // ── Gemini Live API mode (English / Mandarin) ──
          cb.setLiveStatus('正在連線 Live API...');
          // profile 隨 token 請求送出：轉錄 systemInstruction 已改為在簽發 ephemeral
          // token 時鎖入 live_connect_constraints（constrained endpoint 會忽略 client
          // 端 setup），故語言指令必須在此帶上，而非由前端 setup frame 送出。
          const liveProfile = getSpeechProfile(language);
          const tokenRes = await fetch(
            `${API_BASE}/api/live-token?profile=${encodeURIComponent(liveProfile)}`,
            { method: 'POST' },
          );
          if (!tokenRes.ok) {
            throw new Error('無法建立 Gemini Live 安全連線，請稍後再試');
          }
          const tokenData = await tokenRes.json();

          audioContext = new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          audioContextRef.current = audioContext;

          if (audioContext.state === 'suspended') {
            await audioContext.resume();
          }

          inputSampleRate = audioContext.sampleRate;

          client = new LiveClient({
            token: tokenData.token,
            model: tokenData.model,
            onOpen: () => {
              cb.updateDebugSnapshot({ wsOpen: true });
              cb.setLiveStatus('Live API 已連線，正在準備聽寫...');
            },
            onSetupComplete: () => {
              cb.updateDebugSnapshot({ setupComplete: true });
              cb.setLiveStatus('連線成功，請開始說話...');
            },
            onAudioSent: () => {
              cb.updateDebugSnapshot({ audioSent: cb.getDebugSnapshot().audioSent + 1 });
            },
            onTranscription: (text, isFinal) => {
              cb.updateDebugSnapshot({
                transcriptEvents: cb.getDebugSnapshot().transcriptEvents + 1,
              });
              cb.setLiveStatus('');
              if (isFinal) {
                transcriptRef.current += text;
                cb.setFinalTranscript(transcriptRef.current);
                cb.setInterimTranscript('');
              } else {
                cb.setInterimTranscript(text);
              }
            },
            onError: (err) => {
              cb.updateDebugSnapshot({ lastError: err });
              void cb.postDebugEvent('error');
              if (transcriptRef.current.trim() || cb.getDebugSnapshot().transcriptEvents > 0) {
                return;
              }
              cb.setAppErrorMsg(err);
              cleanupAudioPipeline();
              cb.setIsRecording(false);
            },
            onClose: (code, reason) => {
              cb.updateDebugSnapshot({ lastCloseCode: code, lastCloseReason: reason || '' });
              void cb.postDebugEvent('close');
              console.log('WS Connection closed.');
            },
          });

          liveClientRef.current = client;
          client.connect();
        }

        // 5. Connect Worklet Processor (common to both engines)
        await audioContext.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-processor.js`);
        const source = audioContext.createMediaStreamSource(stream);
        const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
        audioWorkletNodeRef.current = workletNode;

        // Pipe Float32 buffer array data from worklet node
        workletNode.port.onmessage = (event) => {
          if (!isCaptureActiveRef.current) return;
          const float32Data = event.data;
          // Resample and convert
          const resampled = resampleTo16k(float32Data, inputSampleRate);
          const pcmBuffer = floatTo16BitPCM(resampled);
          cb.updateDebugSnapshot({
            audioChunks: cb.getDebugSnapshot().audioChunks + 1,
            audioBytes: cb.getDebugSnapshot().audioBytes + pcmBuffer.byteLength,
          });
          // Send via STT client
          client.sendAudioChunk(pcmBuffer);
        };

        source.connect(workletNode);
        workletNode.connect(audioContext.destination); // Required on some Safari versions to keep active
      } catch (err: unknown) {
        console.error(err);
        const message = err instanceof Error ? err.message : '麥克風或 WebSocket 管道初始化失敗';
        cb.setAppErrorMsg(message);
        cleanupAudioPipeline();
        cb.setIsRecording(false);
      }
    },
    [requestMicStream, cleanupAudioPipeline],
  );

  const stopRealRecording = useCallback(
    async (mode: Mode, language: Language) => {
      const cb = cbRef.current;
      const useSenseVoice = usesSenseVoice(language);
      let finalText = '';

      const getVisibleTranscript = () => `${cb.getFinalTranscript()}${cb.getInterimTranscript()}`;

      if (useSenseVoice) {
        // ── SenseVoice stop: flush remaining buffer + wait for all in-flight ──
        const svClient = liveClientRef.current as SenseVoiceWsClient | null;
        cleanupAudioPipeline(false);
        svClient?.sendAudioStreamEnd();
        cb.setLiveStatus('正在等待最後聽寫...');

        finalText = (await svClient?.waitForCompletion()) || '';
        if (!finalText.trim()) {
          finalText = `${transcriptRef.current}${cb.getInterimTranscript()}` || getVisibleTranscript();
        }

        if (liveClientRef.current) {
          liveClientRef.current.disconnect();
          liveClientRef.current = null;
        }
      } else {
        // ── Gemini Live stop: send stream end, wait for final transcript ──
        liveClientRef.current?.sendAudioStreamEnd();

        // Stop local capture immediately, but keep the WebSocket alive briefly so
        // Gemini can flush the final inputTranscription after audioStreamEnd.
        cleanupAudioPipeline(false);
        cb.setLiveStatus('正在等待最後聽寫...');
        await waitForTranscript(3500);

        finalText = transcriptRef.current || cb.getFinalTranscript() || cb.getInterimTranscript();

        if (liveClientRef.current) {
          liveClientRef.current.disconnect();
          liveClientRef.current = null;
        }
      }

      // ── Common: send to Gemini cleanup API ──
      if (!finalText.trim()) {
        await cb.postDebugEvent('no-transcript');
        cb.setLiveStatus('未收到聽寫文字，請再試一次或講近一點');
        return;
      }

      await cb.postDebugEvent('transcript-ready');
      cb.setLiveStatus('');
      cb.triggerVibe(50);

      await cb.runCleanup(finalText, mode, language);
      cb.triggerVibe(40);
    },
    [cleanupAudioPipeline, waitForTranscript],
  );

  // ── public actions ──────────────────────────────────────────────────────────

  const startRecording = useCallback(
    ({ mockMode, language }: StartRecordingArgs) => {
      transcriptRef.current = '';
      if (mockMode) {
        startMockRecording();
      } else {
        void startRealRecording(language);
      }
    },
    [startMockRecording, startRealRecording],
  );

  const stopRecording = useCallback(
    async ({ mockMode, mode, language }: StopRecordingArgs) => {
      if (mockMode) {
        await stopMockRecording(mode, language);
      } else {
        await stopRealRecording(mode, language);
      }
    },
    [stopMockRecording, stopRealRecording],
  );

  const isMicPrimed = useCallback(() => isMicPrimedForSessionRef.current, []);

  // ── unmount cleanup ─────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cleanupAudioPipeline();
      if (mockIntervalRef.current) clearInterval(mockIntervalRef.current);
    };
  }, [cleanupAudioPipeline]);

  return {
    primeMicPermission,
    startRecording,
    stopRecording,
    isMicPrimed,
  };
}
