import React, { useState, useEffect, useRef } from 'react';
import { Mic, Copy, Check, Sliders, ChevronDown, Sparkles, Trash2 } from 'lucide-react';
import { Mode, Language } from './types';
import { resampleTo16k, floatTo16BitPCM } from './audio/converter';
import { LiveClient } from './live/live-client';

export default function App() {
  // Settings & Options state
  const [mode, setMode] = useState<Mode>('message');
  const [language, setLanguage] = useState<Language>('mixed');
  const [mockMode, setMockMode] = useState<boolean>(true); // Default to mock mode for easy development/safety

  // Core status state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [finalTranscript, setFinalTranscript] = useState<string>('');
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
  const liveClientRef = useRef<LiveClient | null>(null);

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

  const cleanupAudioPipeline = () => {
    if (audioWorkletNodeRef.current) {
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
    if (liveClientRef.current) {
      liveClientRef.current.disconnect();
      liveClientRef.current = null;
    }
  };

  const triggerVibe = (ms: number) => {
    if (vibrationEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ms);
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
    const res = await fetch('/api/cleanup', {
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
    setInterimTranscript('正在連線 Live API...');
    setFinalTranscript('');

    try {
      // 1. Get Ephemeral Token from backend (A4)
      const tokenRes = await fetch('/api/live-token', { method: 'POST' });
      if (!tokenRes.ok) {
        throw new Error('無法取得連線 Token (Live Token API 呼召失敗)');
      }
      const tokenData = await tokenRes.json();

      // 2. Request mic permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      mediaStreamRef.current = stream;

      // 3. Initialize AudioContext (iOS Safari requires User Gesture which is satisfied here)
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const inputSampleRate = audioContext.sampleRate;

      // 4. Initialize Live WebSocket Client
      const client = new LiveClient({
        token: tokenData.token,
        model: tokenData.model,
        onOpen: () => {
          setInterimTranscript('連線成功，請開始說話...');
        },
        onTranscription: (text, isFinal) => {
          if (isFinal) {
            setFinalTranscript(prev => prev + text);
            setInterimTranscript('');
          } else {
            setInterimTranscript(text);
          }
        },
        onError: (err) => {
          setErrorMsg(err);
          cleanupAudioPipeline();
          setIsRecording(false);
        },
        onClose: () => {
          console.log('WS Connection closed.');
        }
      });

      liveClientRef.current = client;
      client.connect();

      // 5. Connect Worklet Processor
      await audioContext.audioWorklet.addModule('/pcm-processor.js');
      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
      audioWorkletNodeRef.current = workletNode;

      // Pipe Float32 buffer array data from worklet node
      workletNode.port.onmessage = (event) => {
        const float32Data = event.data;
        // Resample and convert
        const resampled = resampleTo16k(float32Data, inputSampleRate);
        const pcmBuffer = floatTo16BitPCM(resampled);
        // Send via live WebSocket Client
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
    // Collect the final text accumulated
    const finalText = finalTranscript || interimTranscript;
    
    // Shutdown streaming pipeline
    cleanupAudioPipeline();

    if (!finalText.trim()) {
      setIsLoading(false);
      return;
    }

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

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (isRecording) return;
    
    setIsRecording(true);
    setCleanedText('');
    setFinalTranscript('');
    
    if (mockMode) {
      startMockRecording();
    } else {
      startRealRecording();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!isRecording) return;
    
    setIsRecording(false);
    if (mockMode) {
      stopMockRecording();
    } else {
      stopRealRecording();
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
            <button 
              onClick={() => { setMockMode(!mockMode); triggerVibe(20); }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${mockMode ? 'bg-amber-500' : 'bg-zinc-700'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${mockMode ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-white">觸覺震動回饋 (Haptics)</span>
            </div>
            <button 
              onClick={() => { setVibrationEnabled(!vibrationEnabled); triggerVibe(20); }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${vibrationEnabled ? 'bg-blue-500' : 'bg-zinc-700'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${vibrationEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
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
            ) : (
              <p className="text-[#8e8e93] italic">按住底部 Mic 按鈕並開始說話，語音聽寫草稿將在此即時浮現...</p>
            )}
          </div>
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
              placeholder="放開 Mic 按鈕後，Gemini 就會自動修剪贅字、多餘口頭禪，並把精準段落文字呈現於此..."
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

        {/* RECORDING CONTROLLER AREA (PUSH-TO-TALK) */}
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
              onMouseDown={handleTouchStart}
              onMouseUp={handleTouchEnd}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              className={`w-24 h-24 rounded-full flex items-center justify-center relative z-10 transition-all active:scale-90 select-none ${
                isRecording 
                  ? 'bg-red-500 text-white scale-105 shadow-2xl shadow-red-500/20' 
                  : 'bg-gradient-to-tr from-blue-600 to-blue-500 text-white shadow-xl shadow-blue-600/20 hover:shadow-blue-600/30'
              }`}
              style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
              aria-label="按住說話"
            >
              <Mic className={`w-10 h-10 ${isRecording ? 'animate-pulse' : ''}`} />
            </button>
          </div>

          <p className="text-xs font-semibold text-[#8e8e93] select-none uppercase tracking-widest text-center">
            {isRecording ? '🎤 放開立即進行智能整理' : '👆 按住說話 · 放開整理'}
          </p>
        </div>

      </main>
    </div>
  );
}
