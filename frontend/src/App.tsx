import React, { useState, useEffect, useRef } from 'react';
import { Mic, Copy, Check, Settings, ChevronDown, Sparkles, Trash2, Sprout, Tag, Globe, History, AudioLines } from 'lucide-react';
import { Mode, Language } from './types';
import { useCleanup } from './features/cleanup/use-cleanup';
import {
  useRecordingSession,
  createDebugSnapshot,
  type LiveDebugSnapshot,
} from './features/recording/use-recording-session';

const BUILD_LABEL = 'v01:35';

// API base URL: 在 GitHub Pages 上指向 VPS backend，local dev 則用空字串走同源
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

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

// Pure helper — lives at module scope so it can be referenced before the hook call.
const simulateMockCleanup = (raw: string, currentMode: Mode, currentLang: Language): string => {
  let prefix = '【修剪乾淨】';
  if (currentLang === 'yue') prefix = '【廣東話書面】';
  if (currentMode === 'todo') prefix = '【待辦事項】';
  if (currentMode === 'email') prefix = '【電郵格式】';
  if (currentMode === 'prompt') prefix = '【AI Prompt】';

  console.log('Simulating mock cleanup under prefix:', prefix);

  // Simple replacement to simulate cleanup rules
  const cleaned = raw
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

  // Cleanup state — owned by useCleanup hook.
  // simulateMockCleanup is passed as mockCleanup only when mockMode is active.
  const {
    cleanedText,
    isLoading,
    errorMsg,
    runCleanup: hookRunCleanup,
    rerunCleanup,
    setCleanedText,
    clearError,
    resetCleanup,
  } = useCleanup({ mockCleanup: mockMode ? simulateMockCleanup : undefined });

  // UI States
  const [copied, setCopied] = useState<boolean>(false);
  // App-owned error slot for NON-cleanup failures (mic permission, Live errors,
  // pipeline init, clipboard). Cleanup errors live in the useCleanup hook.
  const [appErrorMsg, setAppErrorMsg] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [vibrationEnabled, setVibrationEnabled] = useState<boolean>(true);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [showHistoryPlaceholder, setShowHistoryPlaceholder] = useState<boolean>(false);

  // App-owned debug snapshot: recording telemetry is surfaced in the debug row,
  // so the React state + its mirror ref live here; the recording hook writes into
  // it through the resetDebugSnapshot/updateDebugSnapshot/getDebugSnapshot contract.
  const liveDebugRef = useRef<LiveDebugSnapshot>(createDebugSnapshot());

  // Auto copy effect
  useEffect(() => {
    if (cleanedText && !copied) {
      if (vibrationEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(30);
      }
    }
  }, [cleanedText, copied, vibrationEnabled]);

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

  const triggerVibe = (ms: number) => {
    if (vibrationEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ms);
    }
  };

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

  // Recording/STT lifecycle boundary — owns mic, AudioWorklet, and both STT
  // transports. App drives it through this typed callback contract and keeps
  // ownership of the UI state (transcript/status/error/debug) below.
  const recording = useRecordingSession({
    setInterimTranscript,
    setFinalTranscript,
    setLiveStatus,
    setAppErrorMsg,
    setIsRecording,
    resetDebugSnapshot,
    updateDebugSnapshot,
    getDebugSnapshot: () => liveDebugRef.current,
    runCleanup: hookRunCleanup,
    clearCleanupError: clearError,
    triggerVibe,
    postDebugEvent,
    getInterimTranscript: () => interimTranscript,
    getFinalTranscript: () => finalTranscript,
  });

  const handleMicPress = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();

    if (isRecording) {
      setIsRecording(false);
      void recording.stopRecording({ mockMode, mode, language });
      return;
    }

    if (!mockMode && !recording.isMicPrimed()) {
      void recording.primeMicPermission();
      return;
    }

    setIsRecording(true);
    setFinalTranscript('');
    setInterimTranscript('');
    setLiveStatus('');
    setAppErrorMsg('');
    resetDebugSnapshot();
    resetCleanup();

    recording.startRecording({ mockMode, language });
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
      setAppErrorMsg('複製至剪貼簿失敗');
    }
  };

  // Reset/Clear everything
  const handleReset = () => {
    setFinalTranscript('');
    setInterimTranscript('');
    setLiveStatus('');
    setAppErrorMsg('');
    resetDebugSnapshot();
    resetCleanup();
    triggerVibe(30);
  };

  const handleModeChange = async (nextMode: Mode) => {
    setMode(nextMode);
    await rerunCleanup(nextMode, language, isRecording);
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
              <p>{`${finalTranscript}${interimTranscript}`}</p>
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

            {(errorMsg || appErrorMsg) && (
              <div className="mb-2 bg-red-50 border border-red-200 text-red-600 p-2.5 rounded-xl text-xs flex items-center justify-between">
                <span>{errorMsg || appErrorMsg}</span>
                <button onClick={() => { clearError(); setAppErrorMsg(''); }} className="text-red-500 font-bold px-1.5">✕</button>
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
