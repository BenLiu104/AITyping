import React, { useState, useEffect, useRef } from 'react';
import { Mic, Copy, Check, Settings, ChevronDown, Sparkles, Trash2, Sprout, Tag, Globe, History, AudioLines } from 'lucide-react';
import { Mode, Language } from './types';
import { resampleTo16k, floatTo16BitPCM } from './audio/converter';
import { LiveClient, type SpeechProfile } from './live/live-client';
import { SenseVoiceWsClient } from './live/sensevoice-ws-client';

const BUILD_LABEL = 'v01:35';

// API base URL: 在 GitHub Pages 上指向 VPS backend，local dev 則用空字串走同源
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

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

// Display labels for the front-page selector rows (native <select> logic unchanged).
const MODE_LABELS: Record<Mode, string> = {
  message: '訊息聊天',
  email: '專業電郵',
  todo: '待辦事項',
  prompt: '提示工程',
  semantic: '智能整理',
};

const LANGUAGE_LABELS: Record<Language, string> = {
  mixed: '中英混合',
  yue: '粵語書面',
  'zh-Hant': '繁體中文',
  en: '純英文',
};

const formatTimer = (totalSeconds: number): string => {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

type LiveDebugSnapshot = {
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

const createDebugSnapshot = (): LiveDebugSnapshot => ({
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

export default function App() {
  // Settings & Options state
  const [mode, setMode] = useState<Mode>('semantic');
  const [language, setLanguage] = useState<Language>('mixed');
  const [mockMode, setMockMode] = useState<boolean>(false);

  // Core status state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [finalTranscript, setFinalTranscript] = useState<string>('');
  const [liveStatus, setLiveStatus] = useState<string>('');
  const [liveDebug, setLiveDebug] = useState<LiveDebugSnapshot>(() => createDebugSnapshot());
  const [cleanedText, setCleanedText] = useState<string>('');
  const [cleanupSourceTranscript, setCleanupSourceTranscript] = useState<string>('');
  const [lastCleanedMode, setLastCleanedMode] = useState<Mode | null>(null);
  const [lastCleanedLanguage, setLastCleanedLanguage] = useState<Language | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // UI States
  const [copied, setCopied] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [vibrationEnabled, setVibrationEnabled] = useState<boolean>(true);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [showHistoryPlaceholder, setShowHistoryPlaceholder] = useState<boolean>(false);

  // Audio & WebSocket Pipeline References
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const liveClientRef = useRef<LiveClient | SenseVoiceWsClient | null>(null);
  const transcriptRef = useRef<string>('');
  const cleanupRunIdRef = useRef<number>(0);
  const isPrimingMicPermissionRef = useRef<boolean>(false);
  const isMicPrimedForSessionRef = useRef<boolean>(false);
  const isCaptureActiveRef = useRef<boolean>(false);
  const liveDebugRef = useRef<LiveDebugSnapshot>(createDebugSnapshot());

  // Mock Mode generator timeout ref
  const mockIntervalRef = useRef<any>(null);

  // Auto copy effect
  useEffect(() => {
    if (cleanedText && !copied) {
      if (vibrationEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(30);
      }
    }
  }, [cleanedText, copied, vibrationEnabled]);

  // Clean up audio references on unmount
  useEffect(() => {
    return () => {
      cleanupAudioPipeline();
      if (mockIntervalRef.current) clearInterval(mockIntervalRef.current);
    };
  }, []);

  // Recording timer (display only) — resets on each new recording, clears on stop.
  useEffect(() => {
    if (!isRecording) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const id = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const cleanupAudioPipeline = (disconnectLiveClient = true) => {
    isCaptureActiveRef.current = false;
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.onmessage = null;
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
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
  };

  const triggerVibe = (ms: number) => {
    if (vibrationEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ms);
    }
  };

  const waitForTranscript = async (timeoutMs: number) => {
    const startedAt = Date.now();
    while (!transcriptRef.current.trim() && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  const requestMicStream = () => navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
  });

  const resetDebugSnapshot = () => {
    liveDebugRef.current = createDebugSnapshot();
    setLiveDebug(liveDebugRef.current);
  };

  const updateDebugSnapshot = (patch: Partial<LiveDebugSnapshot>) => {
    liveDebugRef.current = { ...liveDebugRef.current, ...patch };
    setLiveDebug(liveDebugRef.current);
  };

  const postDebugEvent = async (phase: string) => {
    const snapshot = liveDebugRef.current;
    try {
      await fetch(`${API_BASE}/api/debug-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase, build: BUILD_LABEL, ...snapshot }),
      });
    } catch {
      // Debug telemetry must never break the recording flow.
    }
  };

  const primeMicPermission = async () => {
    if (isPrimingMicPermissionRef.current) return;

    isPrimingMicPermissionRef.current = true;
    setErrorMsg('');
    setLiveStatus('正在請求麥克風授權...');

    try {
      const stream = await requestMicStream();
      stream.getTracks().forEach(track => track.stop());
      isMicPrimedForSessionRef.current = true;
      setLiveStatus('麥克風已授權，請重新點一下開始錄音');
      triggerVibe(30);
    } catch (err: any) {
      setLiveStatus('');
      setErrorMsg(err.message || '麥克風授權失敗，請允許 Safari 使用麥克風');
    } finally {
      isPrimingMicPermissionRef.current = false;
      setIsRecording(false);
    }
  };

  // Mock Mode Simulator for Speech-to-Text
  const startMockRecording = () => {
    setErrorMsg('');
    setInterimTranscript('正在聽寫...');
    setFinalTranscript('');
    
    const mockPhrases = [
      '今日天氣真係幾好啊 ',
      'by the way ',
      '聽日我哋幾點見面？ ',
      'let me check my calendar ',
      '唔好意思遲咗覆你。'
    ];
    let currentIdx = 0;
    
    mockIntervalRef.current = setInterval(() => {
      if (currentIdx < mockPhrases.length) {
        const nextPhrase = mockPhrases[currentIdx];
        setInterimTranscript((prev) => prev + nextPhrase);
        setFinalTranscript((prev) => prev + nextPhrase);
        triggerVibe(10);
        currentIdx++;
      } else {
        if (mockIntervalRef.current) clearInterval(mockIntervalRef.current);
      }
    }, 1200);
  };

  const stopMockRecording = async () => {
    if (mockIntervalRef.current) {
      clearInterval(mockIntervalRef.current);
    }
    setInterimTranscript('');
    
    // Call Mock Cleanup or Real VPS /api/cleanup
    setIsLoading(true);
    triggerVibe(50);
    let runId = cleanupRunIdRef.current;

    try {
      const textToClean = finalTranscript || '今日天氣真係幾好啊 by the way 聽日我哋幾點見面？ let me check my calendar 唔好意思遲咗覆你。';
      const targetMode = mode;
      const targetLanguage = language;
      runId = ++cleanupRunIdRef.current;
      setCleanupSourceTranscript(textToClean);
      
      let cleanedResult = '';
      if (!mockMode) {
        cleanedResult = await runCleanup(textToClean, targetMode, targetLanguage);
      } else {
        // Simulation Delay
        await new Promise((resolve) => setTimeout(resolve, 800));
        cleanedResult = simulateMockCleanup(textToClean, targetMode, targetLanguage);
      }

      if (runId !== cleanupRunIdRef.current) return;
      setCleanedText(cleanedResult);
      setLastCleanedMode(targetMode);
      setLastCleanedLanguage(targetLanguage);
    } catch (err: any) {
      setErrorMsg(err.message || '整理失敗，請再試一次');
    } finally {
      if (cleanupRunIdRef.current === runId) {
        setIsLoading(false);
      }
      triggerVibe(40);
    }
  };

  const simulateMockCleanup = (raw: string, currentMode: Mode, currentLang: Language): string => {
    let prefix = '【修剪乾淨】';
    if (currentLang === 'yue') prefix = '【廣東話書面】';
    if (currentMode === 'todo') prefix = '【待辦事項】';
    if (currentMode === 'email') prefix = '【電郵格式】';
    if (currentMode === 'prompt') prefix = '【AI Prompt】';

    console.log('Simulating mock cleanup under prefix:', prefix);

    // Simple replacement to simulate cleanup rules
    let cleaned = raw
      .replace(/by the way/gi, '順帶一提')
      .replace(/let me check my calendar/gi, '讓我確認一下我的行事曆')
      .replace(/唔好意思遲咗覆你。/g, '抱歉晚了回覆你。')
      .trim();

    if (currentMode === 'todo') {
      return `1. 確認明天會議時間\n2. 檢視行事曆日程\n3. 回覆對方郵件`;
    }
    
    if (currentMode === 'email') {
      return `您好：\n\n今天的天氣非常好。順帶一提，請問我們明天幾點見面？我需要確認一下我的行事曆。\n\n抱歉晚了回覆您。\n\n祝好`;
    }

    return `${cleaned}`;
  };

  const callCleanupAPI = async (
    text: string,
    targetMode: Exclude<Mode, 'semantic'>,
    targetLanguage: Language,
  ): Promise<string> => {
    const res = await fetch(`${API_BASE}/api/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawTranscript: text,
        mode: targetMode,
        language: targetLanguage,
        style: 'natural'
      })
    });
    if (!res.ok) throw new Error('Cleanup API 呼叫失敗');
    const data = await res.json();
    return data.cleaned;
  };

  const callSmartCleanupAPI = async (text: string, targetLanguage: Language): Promise<string> => {
    const res = await fetch(`${API_BASE}/api/smart-cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: text,
        languageMode: targetLanguage,
      })
    });
    if (!res.ok) throw new Error('Smart Cleanup API 呼叫失敗');
    const data = await res.json();
    return data.clean_text;
  };

  const runCleanup = (text: string, targetMode: Mode, targetLanguage: Language): Promise<string> =>
    targetMode === 'semantic'
      ? callSmartCleanupAPI(text, targetLanguage)
      : callCleanupAPI(text, targetMode, targetLanguage);

  // Real Audio Pipeline Setup (iOS Safari Compliant)
  const startRealRecording = async () => {
    setErrorMsg('');
    setLiveStatus('正在連線 Live API...');
    resetDebugSnapshot();
    setInterimTranscript('');
    setFinalTranscript('');
    setCleanupSourceTranscript('');
    setLastCleanedMode(null);
    setLastCleanedLanguage(null);
    cleanupRunIdRef.current++;
    transcriptRef.current = '';

    try {
      // 1. Request mic permission first. iOS Safari is strict: getUserMedia must
      // stay directly inside the user gesture path, before unrelated awaits.
      const stream = await requestMicStream();
      mediaStreamRef.current = stream;
      isCaptureActiveRef.current = true;

      // Shared variables set inside the branch below, used by the common
      // worklet pipeline that follows the if/else.
      const useSenseVoice = language === 'yue' || language === 'mixed';
      let audioContext: AudioContext;
      let client: LiveClient | SenseVoiceWsClient;
      let inputSampleRate: number;

      if (useSenseVoice) {
        // ── SenseVoice mode (Cantonese / mixed) — no ephemeral token needed ──
        setLiveStatus('正在連線 SenseVoice...');

        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        inputSampleRate = audioContext.sampleRate;

        client = new SenseVoiceWsClient({
          wsUrl: 'wss://sencevoice.bochibb.qzz.io/ws/transcribe-v2',
          language: getSenseVoiceLanguage(language),
          onOpen: () => {
            updateDebugSnapshot({ wsOpen: true });
            setLiveStatus('SenseVoice 已就緒，請開始說話...');
          },
          onAudioSent: () => {
            updateDebugSnapshot({ audioSent: liveDebugRef.current.audioSent + 1 });
          },
          onEndSent: () => {
            updateDebugSnapshot({ streamEndSent: true });
          },
          onEndAck: () => {
            updateDebugSnapshot({ streamEndAck: true });
          },
          onTranscription: (text, isFinal) => {
            updateDebugSnapshot({ transcriptEvents: liveDebugRef.current.transcriptEvents + 1 });
            setLiveStatus('');
            if (isFinal) {
              transcriptRef.current += text;
              setFinalTranscript(transcriptRef.current);
              setInterimTranscript('');
            } else {
              setInterimTranscript(text);
            }
          },
          onError: (err) => {
            updateDebugSnapshot({ lastError: err });
            if (transcriptRef.current.trim() || liveDebugRef.current.transcriptEvents > 0) {
              return;
            }
            setErrorMsg(err);
            cleanupAudioPipeline();
            setIsRecording(false);
          },
          onClose: (_code, _reason) => {
            updateDebugSnapshot({ lastCloseCode: _code, lastCloseReason: _reason || '' });
            console.log('SenseVoice closed.');
          }
        });

        liveClientRef.current = client;
        client.connect();
      } else {
        // ── Gemini Live API mode (English / Mandarin) ──
        setLiveStatus('正在連線 Live API...');
        const tokenRes = await fetch(`${API_BASE}/api/live-token`, { method: 'POST' });
        if (!tokenRes.ok) {
          throw new Error('無法取得連線 Token (Live Token API 呼叫失敗)');
        }
        const tokenData = await tokenRes.json();

        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;

        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        inputSampleRate = audioContext.sampleRate;

        client = new LiveClient({
          token: tokenData.token,
          model: tokenData.model,
          speechProfile: getSpeechProfile(language),
          onOpen: () => {
            updateDebugSnapshot({ wsOpen: true });
            setLiveStatus('Live API 已連線，正在準備聽寫...');
          },
          onSetupComplete: () => {
            updateDebugSnapshot({ setupComplete: true });
            setLiveStatus('連線成功，請開始說話...');
          },
          onAudioSent: () => {
            updateDebugSnapshot({ audioSent: liveDebugRef.current.audioSent + 1 });
          },
          onTranscription: (text, isFinal) => {
            updateDebugSnapshot({ transcriptEvents: liveDebugRef.current.transcriptEvents + 1 });
            setLiveStatus('');
            if (isFinal) {
              transcriptRef.current += text;
              setFinalTranscript(transcriptRef.current);
              setInterimTranscript('');
            } else {
              setInterimTranscript(text);
            }
          },
          onError: (err) => {
            updateDebugSnapshot({ lastError: err });
            void postDebugEvent('error');
            if (transcriptRef.current.trim() || liveDebugRef.current.transcriptEvents > 0) {
              return;
            }
            setErrorMsg(err);
            cleanupAudioPipeline();
            setIsRecording(false);
          },
          onClose: (code, reason) => {
            updateDebugSnapshot({ lastCloseCode: code, lastCloseReason: reason || '' });
            void postDebugEvent('close');
            console.log('WS Connection closed.');
          }
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
        updateDebugSnapshot({
          audioChunks: liveDebugRef.current.audioChunks + 1,
          audioBytes: liveDebugRef.current.audioBytes + pcmBuffer.byteLength,
        });
        // Send via STT client
        client.sendAudioChunk(pcmBuffer);
      };

      source.connect(workletNode);
      workletNode.connect(audioContext.destination); // Required on some Safari versions to keep active

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || '麥克風或 WebSocket 管道初始化失敗');
      cleanupAudioPipeline();
      setIsRecording(false);
    }
  };

  const getVisibleTranscript = () => `${finalTranscript}${interimTranscript}`;

  const stopRealRecording = async () => {
    const useSenseVoice = language === 'yue' || language === 'mixed';
    let finalText = '';

    if (useSenseVoice) {
      // ── SenseVoice stop: flush remaining buffer + wait for all in-flight ──
      const svClient = liveClientRef.current as SenseVoiceWsClient | null;
      cleanupAudioPipeline(false);
      svClient?.sendAudioStreamEnd();
      setLiveStatus('正在等待最後聽寫...');

      finalText = await svClient?.waitForCompletion() || '';
      if (!finalText.trim()) {
        finalText = `${transcriptRef.current}${interimTranscript}` || getVisibleTranscript();
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
      setLiveStatus('正在等待最後聽寫...');
      await waitForTranscript(3500);

      finalText = transcriptRef.current || finalTranscript || interimTranscript;

      if (liveClientRef.current) {
        liveClientRef.current.disconnect();
        liveClientRef.current = null;
      }
    }

    // ── Common: send to Gemini cleanup API ──
    if (!finalText.trim()) {
      await postDebugEvent('no-transcript');
      setIsLoading(false);
      setLiveStatus('未收到聽寫文字，請再試一次或講近一點');
      return;
    }

    await postDebugEvent('transcript-ready');
    setLiveStatus('');
    setIsLoading(true);
    triggerVibe(50);
    let runId = cleanupRunIdRef.current;

    try {
      const targetMode = mode;
      const targetLanguage = language;
      runId = ++cleanupRunIdRef.current;
      setCleanupSourceTranscript(finalText);
      const cleanedResult = await runCleanup(finalText, targetMode, targetLanguage);
      if (runId !== cleanupRunIdRef.current) return;
      setCleanedText(cleanedResult);
      setLastCleanedMode(targetMode);
      setLastCleanedLanguage(targetLanguage);
    } catch (err: any) {
      setErrorMsg(err.message || '整理失敗，請再試一次');
    } finally {
      if (cleanupRunIdRef.current === runId) {
        setIsLoading(false);
      }
      triggerVibe(40);
    }
  };

  const handleMicPress = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();

    if (isRecording) {
      setIsRecording(false);
      if (mockMode) {
        void stopMockRecording();
      } else {
        void stopRealRecording();
      }
      return;
    }

    if (!mockMode && !isMicPrimedForSessionRef.current) {
      void primeMicPermission();
      return;
    }

    setIsRecording(true);
    setCleanedText('');
    setFinalTranscript('');
    setInterimTranscript('');
    setCleanupSourceTranscript('');
    setLastCleanedMode(null);
    setLastCleanedLanguage(null);
    cleanupRunIdRef.current++;
    setLiveStatus('');
    resetDebugSnapshot();
    transcriptRef.current = '';
    
    if (mockMode) {
      startMockRecording();
    } else {
      startRealRecording();
    }
  };

  // Copy to Clipboard
  const handleCopy = async () => {
    if (!cleanedText) return;
    try {
      await navigator.clipboard.writeText(cleanedText);
      setCopied(true);
      triggerVibe(40);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMsg('複製至剪貼簿失敗');
    }
  };

  // Reset/Clear everything
  const handleReset = () => {
    setFinalTranscript('');
    setInterimTranscript('');
    setCleanedText('');
    setCleanupSourceTranscript('');
    setLastCleanedMode(null);
    setLastCleanedLanguage(null);
    cleanupRunIdRef.current++;
    setErrorMsg('');
    setLiveStatus('');
    resetDebugSnapshot();
    transcriptRef.current = '';
    triggerVibe(30);
  };

  const handleModeChange = async (nextMode: Mode) => {
    setMode(nextMode);

    if (isRecording) return;
    if (!cleanupSourceTranscript.trim()) return;
    if (cleanedText && nextMode === lastCleanedMode && language === lastCleanedLanguage) return;

    const targetLanguage = language;
    const sourceTranscript = cleanupSourceTranscript;
    const runId = ++cleanupRunIdRef.current;
    setIsLoading(true);
    setErrorMsg('');

    try {
      const cleanedResult = mockMode
        ? simulateMockCleanup(sourceTranscript, nextMode, targetLanguage)
        : await runCleanup(sourceTranscript, nextMode, targetLanguage);

      if (runId !== cleanupRunIdRef.current) return;
      setCleanedText(cleanedResult);
      setLastCleanedMode(nextMode);
      setLastCleanedLanguage(targetLanguage);
    } catch (err: any) {
      if (runId !== cleanupRunIdRef.current) return;
      setErrorMsg(err.message || '整理失敗，請再試一次');
    } finally {
      if (runId === cleanupRunIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="flex flex-col min-h-screen w-full bg-[var(--color-bg)] text-[var(--color-text)] safe-padding-top selection:bg-[var(--color-primary)]/20">

      {/* HEADER */}
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-9 h-9 rounded-2xl bg-[var(--color-pill-green)]">
            <Sprout className="w-5 h-5 text-[var(--color-primary)]" />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">AITyping</h1>
          {mockMode && (
            <span className="text-[10px] bg-[var(--color-pill-yellow)] text-[#8a6d1a] px-2 py-0.5 rounded-full font-semibold">
              MOCK
            </span>
          )}
        </div>

        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2.5 rounded-full transition-colors ${showSettings ? 'bg-[var(--color-pill-green)] text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:bg-black/5'}`}
          aria-label="設定"
        >
          <Settings className="w-5 h-5" />
        </button>
      </header>

      {/* SETTINGS DRAWER — mock + haptics only */}
      {showSettings && (
        <section className="mx-5 mb-2 rounded-2xl bg-[var(--color-card)] p-5 space-y-4 shadow-[0_4px_16px_rgba(60,80,60,0.08)]">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-[var(--color-text)]">沙盒/模擬模式</span>
              <span className="text-xs text-[var(--color-text-muted)]">不消耗 API 金鑰額度</span>
            </div>
            <label className="relative inline-flex h-8 w-14 cursor-pointer items-center rounded-full">
              <input
                type="checkbox"
                checked={mockMode}
                onChange={(event) => { setMockMode(event.target.checked); triggerVibe(20); }}
                className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                aria-label="切換沙盒模擬模式"
              />
              <span className="pointer-events-none absolute inset-1 rounded-full bg-zinc-300 transition-colors peer-checked:bg-[var(--color-primary)]" />
              <span className="pointer-events-none relative ml-1 inline-block h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-6" />
            </label>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)]">
            <span className="text-sm font-semibold text-[var(--color-text)]">觸覺震動回饋</span>
            <label className="relative inline-flex h-8 w-14 cursor-pointer items-center rounded-full">
              <input
                type="checkbox"
                checked={vibrationEnabled}
                onChange={(event) => { setVibrationEnabled(event.target.checked); triggerVibe(20); }}
                className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                aria-label="切換觸覺震動回饋"
              />
              <span className="pointer-events-none absolute inset-1 rounded-full bg-zinc-300 transition-colors peer-checked:bg-[var(--color-primary)]" />
              <span className="pointer-events-none relative ml-1 inline-block h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-6" />
            </label>
          </div>
        </section>
      )}

      {/* MAIN */}
      <main className="flex-1 flex flex-col px-5 pb-44 gap-4">

        {/* MODE SELECTOR ROW */}
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5 bg-[var(--color-pill-yellow)]">
          <Tag className="w-5 h-5 text-[#B8860B] shrink-0" />
          <span className="text-sm font-semibold text-[var(--color-text)] shrink-0">整理模式</span>
          <div className="relative ml-auto flex items-center">
            <select
              value={mode}
              onChange={(e) => {
                void handleModeChange(e.target.value as Mode);
              }}
              aria-label="整理模式"
              className="appearance-none bg-transparent text-right text-sm font-semibold text-[var(--color-text)] pr-6 outline-none cursor-pointer"
            >
              <option value="message">{MODE_LABELS.message}</option>
              <option value="email">{MODE_LABELS.email}</option>
              <option value="todo">{MODE_LABELS.todo}</option>
              <option value="prompt">{MODE_LABELS.prompt}</option>
              <option value="semantic">{MODE_LABELS.semantic}</option>
            </select>
            <ChevronDown className="w-4 h-4 absolute right-0 text-[var(--color-text-muted)] pointer-events-none" />
          </div>
        </div>

        {/* LANGUAGE SELECTOR ROW */}
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5 bg-[var(--color-pill-green)]">
          <Globe className="w-5 h-5 text-[var(--color-primary)] shrink-0" />
          <span className="text-sm font-semibold text-[var(--color-text)] shrink-0">語言模式</span>
          <div className="relative ml-auto flex items-center">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              aria-label="語言模式"
              className="appearance-none bg-transparent text-right text-sm font-semibold text-[var(--color-text)] pr-6 outline-none cursor-pointer"
            >
              <option value="mixed">{LANGUAGE_LABELS.mixed}</option>
              <option value="yue">{LANGUAGE_LABELS.yue}</option>
              <option value="zh-Hant">{LANGUAGE_LABELS['zh-Hant']}</option>
              <option value="en">{LANGUAGE_LABELS.en}</option>
            </select>
            <ChevronDown className="w-4 h-4 absolute right-0 text-[var(--color-text-muted)] pointer-events-none" />
          </div>
        </div>

        {/* TRANSCRIPT CARD */}
        <div className="flex flex-col rounded-2xl bg-[var(--color-card)] p-4 shadow-[0_4px_16px_rgba(60,80,60,0.08)] min-h-[120px]">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-primary)]">
              <AudioLines className="w-4 h-4" />
              即時聽寫
            </span>
            {isRecording && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="tabular-nums">{formatTimer(elapsedSeconds)}</span>
                <span className="uppercase tracking-widest text-[10px]">RECORDING</span>
              </span>
            )}
          </div>
          <div className="flex-1 text-base leading-relaxed text-[var(--color-text)]">
            {finalTranscript || interimTranscript ? (
              <p>{getVisibleTranscript()}</p>
            ) : liveStatus ? (
              <p className="text-[var(--color-text-muted)] italic">{liveStatus}</p>
            ) : (
              <p className="text-[var(--color-text-muted)] italic">點一下下方麥克風開始說話，再點一下停止並整理…</p>
            )}
          </div>
          {import.meta.env.DEV && (
            <p className="mt-2 text-[10px] text-[var(--color-text-muted)]/70">
              debug {BUILD_LABEL}: ws={liveDebug.wsOpen ? '1' : '0'} setup={liveDebug.setupComplete ? '1' : '0'} chunks={liveDebug.audioChunks} bytes={liveDebug.audioBytes} sent={liveDebug.audioSent} tx={liveDebug.transcriptEvents} end={liveDebug.streamEndSent ? '1' : '0'} ack={liveDebug.streamEndAck ? '1' : '0'} close={liveDebug.lastCloseCode ?? '-'}
            </p>
          )}
        </div>

        {/* CLEANUP RESULT CARD */}
        <div className="flex flex-col rounded-2xl bg-[var(--color-card)] p-4 shadow-[0_4px_16px_rgba(60,80,60,0.08)] min-h-[160px]">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-primary)]">
              <Sparkles className="w-4 h-4" />
              智能整理結果
            </span>
            <div className="flex items-center gap-1">
              {cleanedText && (
                <>
                  <button
                    onClick={handleCopy}
                    className={`p-1.5 rounded-lg transition-colors ${copied ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:bg-black/5'}`}
                    title="複製"
                    aria-label="複製整理結果"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={handleReset}
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:bg-black/5 transition-colors"
                    title="清除"
                    aria-label="清除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 relative">
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-card)]/80 space-y-3 z-10">
                <div className="w-8 h-8 border-3 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-[var(--color-text-muted)] font-medium">智能整理中…</p>
              </div>
            )}

            {errorMsg && (
              <div className="mb-2 bg-red-50 border border-red-200 text-red-600 p-2.5 rounded-xl text-xs flex items-center justify-between">
                <span>{errorMsg}</span>
                <button onClick={() => setErrorMsg('')} className="text-red-500 font-bold px-1.5">✕</button>
              </div>
            )}

            <textarea
              value={cleanedText}
              onChange={(e) => setCleanedText(e.target.value)}
              placeholder="停止錄音後，這裡會顯示整理好的文字…"
              className="w-full min-h-[96px] bg-transparent text-[var(--color-text)] border-none outline-none resize-none text-base leading-relaxed placeholder:text-[var(--color-text-muted)]/60 placeholder:italic"
            />
          </div>
        </div>
      </main>

      {/* BOTTOM CONTROLS — mic (center) + history (right) */}
      <div className="fixed bottom-0 inset-x-0 bg-gradient-to-t from-[var(--color-bg)] via-[var(--color-bg)] to-transparent pt-8 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        <div className="grid grid-cols-3 items-center px-8 max-w-md mx-auto">
          <div />
          <div className="flex justify-center">
            <div className="relative">
              {isRecording && (
                <>
                  <div className="absolute inset-0 bg-[var(--color-primary)]/25 rounded-full animate-ping" />
                  <div className="absolute inset-0 bg-[var(--color-primary)]/15 rounded-full animate-ping scale-110" />
                </>
              )}
              <button
                onPointerDown={handleMicPress}
                className={`w-20 h-20 rounded-full flex items-center justify-center relative z-10 transition-all active:scale-90 select-none shadow-[0_8px_24px_rgba(76,175,103,0.35)] ${
                  isRecording
                    ? 'bg-red-500 text-white scale-105'
                    : 'bg-[var(--color-primary)] text-white'
                }`}
                style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
                aria-label={isRecording ? '停止錄音並整理' : '點一下開始錄音'}
              >
                <Mic className={`w-9 h-9 ${isRecording ? 'animate-pulse' : ''}`} />
              </button>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => { setShowHistoryPlaceholder(true); triggerVibe(20); }}
              className="flex flex-col items-center gap-1 text-[var(--color-text-muted)] active:scale-95 transition-transform"
              aria-label="歷史紀錄"
            >
              <span className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-card)] shadow-[0_4px_16px_rgba(60,80,60,0.08)]">
                <History className="w-5 h-5" />
              </span>
              <span className="text-[10px] font-medium">歷史紀錄</span>
            </button>
          </div>
        </div>
      </div>

      {/* HISTORY PLACEHOLDER MODAL */}
      {showHistoryPlaceholder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-8"
          onClick={() => setShowHistoryPlaceholder(false)}
        >
          <div
            className="rounded-2xl bg-[var(--color-card)] p-6 max-w-xs w-full text-center space-y-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[var(--color-pill-green)] mx-auto">
              <History className="w-6 h-6 text-[var(--color-primary)]" />
            </span>
            <p className="text-base font-semibold text-[var(--color-text)]">歷史紀錄即將推出</p>
            <p className="text-sm text-[var(--color-text-muted)]">這個功能還在打磨中，敬請期待。</p>
            <button
              onClick={() => setShowHistoryPlaceholder(false)}
              className="mt-2 w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-semibold active:scale-[0.98] transition-transform"
            >
              好的
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
