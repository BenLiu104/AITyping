import React, { useState, useEffect, useRef } from 'react';
import { Mic, Copy, Check, Sliders, ChevronDown, Sparkles, Trash2 } from 'lucide-react';
import { Mode, Language } from './types';
import { resampleTo16k, floatTo16BitPCM } from './audio/converter';
import { LiveClient, type SpeechProfile } from './live/live-client';
import { SenseVoiceWsClient } from './live/sensevoice-ws-client';

const BUILD_LABEL = 'v12:18';

// API base URL: 在 GitHub Pages 上指向 VPS backend，local dev 則用空字串走同源
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

const getSpeechProfile = (language: Language): SpeechProfile => {
  if (language === 'mixed') return 'cantonese-english';
  if (language === 'yue') return 'cantonese';
  if (language === 'en') return 'english';
  return 'auto';
};

type LiveDebugSnapshot = {
  wsOpen: boolean;
  setupComplete: boolean;
  audioChunks: number;
  audioBytes: number;
  audioSent: number;
  transcriptEvents: number;
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
  lastCloseReason: '',
  lastError: '',
});

export default function App() {
  // Settings & Options state
  const [mode, setMode] = useState<Mode>('message');
  const [language, setLanguage] = useState<Language>('mixed');
  const [mockMode, setMockMode] = useState<boolean>(false);

  // Core status state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [finalTranscript, setFinalTranscript] = useState<string>('');
  const [liveStatus, setLiveStatus] = useState<string>('');
  const [liveDebug, setLiveDebug] = useState<LiveDebugSnapshot>(() => createDebugSnapshot());
  const [cleanedText, setCleanedText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // UI States
  const [copied, setCopied] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [vibrationEnabled, setVibrationEnabled] = useState<boolean>(true);

  // Audio & WebSocket Pipeline References
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const liveClientRef = useRef<LiveClient | SenseVoiceWsClient | null>(null);
  const transcriptRef = useRef<string>('');
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

    try {
      const textToClean = finalTranscript || '今日天氣真係幾好啊 by the way 聽日我哋幾點見面？ let me check my calendar 唔好意思遲咗覆你。';
      
      let cleanedResult = '';
      if (!mockMode) {
        cleanedResult = await callCleanupAPI(textToClean);
      } else {
        // Simulation Delay
        await new Promise((resolve) => setTimeout(resolve, 800));
        cleanedResult = simulateMockCleanup(textToClean, mode, language);
      }
      
      setCleanedText(cleanedResult);
    } catch (err: any) {
      setErrorMsg(err.message || '整理失敗，請再試一次');
    } finally {
      setIsLoading(false);
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

  const callCleanupAPI = async (text: string): Promise<string> => {
    const res = await fetch(`${API_BASE}/api/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawTranscript: text,
        mode,
        language,
        style: 'natural'
      })
    });
    if (!res.ok) throw new Error('Cleanup API 呼叫失敗');
    const data = await res.json();
    return data.cleaned;
  };

  // Real Audio Pipeline Setup (iOS Safari Compliant)
  const startRealRecording = async () => {
    setErrorMsg('');
    setLiveStatus('正在連線 Live API...');
    resetDebugSnapshot();
    setInterimTranscript('');
    setFinalTranscript('');
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
          wsUrl: 'wss://sencevoice.bochibb.qzz.io/ws/transcribe',
          language: 'yue',
          onOpen: () => {
            updateDebugSnapshot({ wsOpen: true });
            setLiveStatus('SenseVoice 已就緒，請開始說話...');
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

  const stopRealRecording = async () => {
    const useSenseVoice = language === 'yue' || language === 'mixed';
    let finalText = '';

    if (useSenseVoice) {
      // ── SenseVoice stop: flush remaining buffer + wait for all in-flight ──
      const svClient = liveClientRef.current as SenseVoiceWsClient | null;
      svClient?.sendAudioStreamEnd();
      cleanupAudioPipeline(false);
      setLiveStatus('正在等待最後聽寫...');

      finalText = await svClient?.waitForCompletion() || '';

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

    try {
      const cleanedResult = await callCleanupAPI(finalText);
      setCleanedText(cleanedResult);
    } catch (err: any) {
      setErrorMsg(err.message || '整理失敗，請再試一次');
    } finally {
      setIsLoading(false);
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
    setErrorMsg('');
    setLiveStatus('');
    resetDebugSnapshot();
    transcriptRef.current = '';
    triggerVibe(30);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#121212] text-[#f5f5f7] safe-padding-top safe-padding-bottom selection:bg-[#2563eb]">
      
      {/* HEADER / NAVIGATION BAR */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-[#222] bg-[#1a1a1a]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-500 animate-pulse" />
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-[#a1a1aa] bg-clip-text text-transparent">
            AITyping
          </h1>
          <span className="text-[10px] text-[#8e8e93]">{BUILD_LABEL}</span>
          {mockMode && (
            <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-semibold border border-amber-500/30">
              MOCK
            </span>
          )}
        </div>

        <button 
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-blue-500/20 text-blue-400' : 'text-[#a1a1aa] hover:bg-[#222]'}`}
          aria-label="設定"
        >
          <Sliders className="w-5 h-5" />
        </button>
      </header>

      {/* SETTINGS PANEL (COLLAPSIBLE) */}
      {showSettings && (
        <section className="bg-[#1c1c1e] border-b border-[#2c2c2e] p-5 space-y-4 transition-all duration-300">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#8e8e93] mb-1.5 uppercase tracking-wider">整理模式</label>
              <div className="relative">
                <select 
                  value={mode} 
                  onChange={(e) => setMode(e.target.value as Mode)}
                  className="w-full bg-[#2c2c2e] text-white rounded-xl px-3 py-2.5 text-sm appearance-none outline-none border border-[#3a3a3c] focus:border-blue-500"
                >
                  <option value="message">💬 訊息聊天 (Message)</option>
                  <option value="email">✉️ 專業電郵 (Email)</option>
                  <option value="todo">📋 待辦事項 (TODO)</option>
                  <option value="prompt">🤖 提示工程 (Prompt)</option>
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-3.5 text-[#8e8e93] pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#8e8e93] mb-1.5 uppercase tracking-wider">語言模式</label>
              <div className="relative">
                <select 
                  value={language} 
                  onChange={(e) => setLanguage(e.target.value as Language)}
                  className="w-full bg-[#2c2c2e] text-white rounded-xl px-3 py-2.5 text-sm appearance-none outline-none border border-[#3a3a3c] focus:border-blue-500"
                >
                  <option value="mixed">🔄 中英混合 (Mixed)</option>
                  <option value="yue">🦁 粵語書面 (Cantonese)</option>
                  <option value="zh-Hant">🇹🇼 繁體中文 (Trad Chinese)</option>
                  <option value="en">🇬🇧 純英文 (English)</option>
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-3.5 text-[#8e8e93] pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#2c2c2e]">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-white">沙盒/模擬模式 (Mock)</span>
              <span className="text-xs text-[#8e8e93]">(不消耗 API 金鑰額度)</span>
            </div>
            <label className="relative inline-flex h-8 w-14 cursor-pointer items-center rounded-full">
              <input
                type="checkbox"
                checked={mockMode}
                onChange={(event) => { setMockMode(event.target.checked); triggerVibe(20); }}
                className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                aria-label="切換沙盒模擬模式"
              />
              <span className="pointer-events-none absolute inset-1 rounded-full bg-zinc-700 transition-colors peer-checked:bg-amber-500" />
              <span className="pointer-events-none relative ml-1 inline-block h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-6" />
            </label>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-white">觸覺震動回饋 (Haptics)</span>
            </div>
            <label className="relative inline-flex h-8 w-14 cursor-pointer items-center rounded-full">
              <input
                type="checkbox"
                checked={vibrationEnabled}
                onChange={(event) => { setVibrationEnabled(event.target.checked); triggerVibe(20); }}
                className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                aria-label="切換觸覺震動回饋"
              />
              <span className="pointer-events-none absolute inset-1 rounded-full bg-zinc-700 transition-colors peer-checked:bg-blue-500" />
              <span className="pointer-events-none relative ml-1 inline-block h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-6" />
            </label>
          </div>
        </section>
      )}

      {/* MAIN LAYOUT */}
      <main className="flex-1 flex flex-col p-5 space-y-4 overflow-hidden">
        
        {/* TRANSCRIPT PREVIEW PANEL */}
        <div className="flex-1 min-h-[100px] flex flex-col bg-[#1c1c1e] rounded-2xl p-4 border border-[#2c2c2e] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[#8e8e93] uppercase tracking-wider">即時聽寫草稿 (Live Transcript)</span>
            {isRecording && (
              <span className="flex items-center gap-1.5 text-xs text-red-500 font-semibold animate-pulse">
                <span className="w-2.5 h-2.5 bg-red-500 rounded-full" />
                RECORDING
              </span>
            )}
          </div>
          <div className="flex-1 text-sm leading-relaxed text-zinc-300">
            {finalTranscript || interimTranscript ? (
              <p>{finalTranscript || interimTranscript}</p>
            ) : liveStatus ? (
              <p className="text-[#8e8e93] italic">{liveStatus}</p>
            ) : (
              <p className="text-[#8e8e93] italic">點一下底部 Mic 開始錄音，再點一下停止並整理...</p>
            )}
          </div>
          <p className="mt-2 text-[10px] text-[#6b7280]">
            debug {BUILD_LABEL}: ws={liveDebug.wsOpen ? '1' : '0'} setup={liveDebug.setupComplete ? '1' : '0'} chunks={liveDebug.audioChunks} bytes={liveDebug.audioBytes} sent={liveDebug.audioSent} tx={liveDebug.transcriptEvents} close={liveDebug.lastCloseCode ?? '-'}
          </p>
        </div>

        {/* CLEANED OUTPUT PANEL */}
        <div className="flex-[1.5] min-h-[150px] flex flex-col bg-[#1c1c1e] rounded-2xl p-4 border border-[#2c2c2e] overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-blue-500 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              智能整理結果 (Cleaned Result)
            </span>
            <div className="flex items-center gap-2">
              {cleanedText && (
                <button 
                  onClick={handleReset}
                  className="p-1.5 hover:bg-[#2c2c2e] text-[#8e8e93] hover:text-white rounded-lg transition-colors"
                  title="清除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          
          <div className="flex-1 relative overflow-hidden">
            {isLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1c1c1e]/80 backdrop-blur-xs space-y-3">
                <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-[#8e8e93] font-medium">Gemini 智能語音整理中...</p>
              </div>
            ) : null}

            {errorMsg && (
              <div className="absolute inset-x-0 top-0 bg-red-500/10 border border-red-500/20 text-red-400 p-2.5 rounded-xl text-xs flex items-center justify-between mb-2 z-20">
                <span>{errorMsg}</span>
                <button onClick={() => setErrorMsg('')} className="text-red-400 font-bold px-1.5 hover:bg-red-500/20 rounded">✕</button>
              </div>
            )}

            <textarea
              value={cleanedText}
              onChange={(e) => setCleanedText(e.target.value)}
              placeholder="停止錄音後，Gemini 就會自動修剪贅字、多餘口頭禪，並把精準段落文字呈現於此..."
              className="w-full h-full bg-transparent text-white border-none outline-none resize-none text-base leading-relaxed placeholder:text-[#555] placeholder:italic"
            />
          </div>

          {/* COPY ACTION BUTTON */}
          <div className="mt-3">
            <button
              onClick={handleCopy}
              disabled={!cleanedText || isLoading}
              className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold transition-all ${
                cleanedText 
                  ? copied 
                    ? 'bg-emerald-600 text-white' 
                    : 'bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-bold shadow-lg shadow-blue-600/10' 
                  : 'bg-[#2c2c2e] text-zinc-600 cursor-not-allowed'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-5 h-5" />
                  已複製至剪貼簿！
                </>
              ) : (
                <>
                  <Copy className="w-5 h-5" />
                  一鍵複製結果
                </>
              )}
            </button>
          </div>
        </div>

        {/* RECORDING CONTROLLER AREA (TAP-TO-TOGGLE) */}
        <div className="flex flex-col items-center justify-center py-4 space-y-3">
          <div className="relative">
            {/* Pulsing radar effects when recording */}
            {isRecording && (
              <>
                <div className="absolute inset-0 bg-blue-500/30 rounded-full animate-ping scale-150" />
                <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping scale-125" />
              </>
            )}

            <button
              onPointerDown={handleMicPress}
              className={`w-24 h-24 rounded-full flex items-center justify-center relative z-10 transition-all active:scale-90 select-none ${
                isRecording 
                  ? 'bg-red-500 text-white scale-105 shadow-2xl shadow-red-500/20' 
                  : 'bg-gradient-to-tr from-blue-600 to-blue-500 text-white shadow-xl shadow-blue-600/20 hover:shadow-blue-600/30'
              }`}
              style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
              aria-label={isRecording ? '停止錄音並整理' : '點一下開始錄音'}
            >
              <Mic className={`w-10 h-10 ${isRecording ? 'animate-pulse' : ''}`} />
            </button>
          </div>

          <p className="text-xs font-semibold text-[#8e8e93] select-none uppercase tracking-widest text-center">
            {isRecording ? '🎤 錄音中 · 再點一下停止整理' : '👆 點一下開始錄音 · 再點一下停止'}
          </p>
        </div>

      </main>
    </div>
  );
}
