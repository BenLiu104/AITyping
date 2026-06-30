/**
 * SenseVoice REST API Client
 *
 * 取代 Gemini Live WebSocket，用本地 SenseVoice (FunASR) 做 Cantonese STT。
 * 提供同 LiveClient 相容嘅 interface（connect / sendAudioChunk /
 * sendAudioStreamEnd / disconnect），喺內部用 buffer + periodic flush
 * 模擬 streaming 效果。
 */

export interface SenseVoiceClientConfig {
  apiUrl: string;
  language: string;            // 'yue' | 'zh' | 'auto'
  chunkDurationMs?: number;    // 每段 audio 嘅長度 (ms, default 2000)
  sampleRate?: number;         // PCM sample rate (default 16000)
  onTranscription: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  onClose: (code?: number, reason?: string) => void;
  onOpen?: () => void;
}

const DEFAULT_CONFIG: Partial<SenseVoiceClientConfig> = {
  chunkDurationMs: 2000,
  sampleRate: 16000,
};

export class SenseVoiceClient {
  private config: SenseVoiceClientConfig;
  private buffer: Uint8Array = new Uint8Array(0);
  private pendingRequests: Map<string, AbortController> = new Map();
  private isConnected = false;
  private isFlushing = false;
  private resolveCompletion: ((text: string) => void) | null = null;
  private completionPromise: Promise<string> | null = null;
  private fullTranscript = '';
  private requestIdCounter = 0;
  private readonly targetChunkBytes: number;

  constructor(config: SenseVoiceClientConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as SenseVoiceClientConfig;
    // 2s of 16kHz 16-bit mono PCM = 16000 * 2 * (chunkDurationMs / 1000) bytes
    const sr = this.config.sampleRate ?? 16000;
    const dur = (this.config.chunkDurationMs ?? 2000) / 1000;
    this.targetChunkBytes = Math.round(sr * 2 * dur);
  }

  /** 準備開始錄音 (no WS needed, just marks ready) */
  connect() {
    this.isConnected = true;
    this.buffer = new Uint8Array(0);
    this.fullTranscript = '';
    this.isFlushing = false;
    this.pendingRequests.clear();
    this.completionPromise = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
    this.config.onOpen?.();
  }

  /**
   * 接收從 AudioWorklet 嚟嘅 PCM Int16 chunk。
   * 內部 buffer 夠 2s 就自動 flush 去 SenseVoice API。
   */
  sendAudioChunk(pcmBuffer: ArrayBuffer) {
    if (!this.isConnected) return;

    const newBytes = new Uint8Array(pcmBuffer);
    const combined = new Uint8Array(this.buffer.length + newBytes.length);
    combined.set(this.buffer, 0);
    combined.set(newBytes, this.buffer.length);
    this.buffer = combined;

    // Flush 夠 target 嘅 chunk
    while (this.buffer.length >= this.targetChunkBytes) {
      const chunk = this.buffer.slice(0, this.targetChunkBytes);
      this.buffer = this.buffer.slice(this.targetChunkBytes);
      this.sendChunk(chunk);
    }
  }

  /** 通知音訊結束：flush 剩餘 buffer + 等全部 in-flight 完成 */
  sendAudioStreamEnd() {
    if (!this.isConnected) return;
    this.isFlushing = true;

    // Flush 剩餘嘅 buffer（最尾唔夠 2s 嘅碎料）
    if (this.buffer.length > 0) {
      this.sendChunk(this.buffer);
      this.buffer = new Uint8Array(0);
    }

    // 如果已經冇 pending request，即時 resolve
    if (this.pendingRequests.size === 0) {
      this.resolveCompletion?.(this.fullTranscript);
    }
  }

  /**
   * 等全部 in-flight request 完成，回傳完整 transcript。
   * 喺 stopRealRecording call。
   */
  async waitForCompletion(): Promise<string> {
    if (!this.completionPromise) {
      return this.fullTranscript;
    }
    return this.completionPromise;
  }

  /** 關閉 client：abort 所有 pending request */
  disconnect() {
    this.isConnected = false;
    for (const [_id, controller] of this.pendingRequests) {
      controller.abort();
    }
    this.pendingRequests.clear();
    this.buffer = new Uint8Array(0);
    this.resolveCompletion?.(this.fullTranscript);
    this.config.onClose(1000, 'disconnected');
  }

  // ── Private helpers ──────────────────────────

  private sendChunk(pcmBytes: Uint8Array) {
    const requestId = `sv_${++this.requestIdCounter}`;
    const controller = new AbortController();
    this.pendingRequests.set(requestId, controller);

    const wavBlob = this.encodeWAV(pcmBytes, this.config.sampleRate ?? 16000);
    this.postChunk(wavBlob, requestId, controller);
  }

  private async postChunk(
    wavBlob: Blob,
    requestId: string,
    controller: AbortController,
  ) {
    try {
      const res = await fetch(`${this.config.apiUrl}/transcribe?language=${this.config.language}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
        },
        body: wavBlob,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`SenseVoice HTTP ${res.status}`);
      }

      const data = await res.json();
      const text: string = (data as { transcript?: string }).transcript || '';

      if (text.trim()) {
        this.fullTranscript += text;
        this.config.onTranscription(text, true);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      this.config.onError(`SenseVoice 辨識錯誤: ${msg}`);
    } finally {
      this.pendingRequests.delete(requestId);
      // 如果係 flushing 而且所有 request 完成，resolve
      if (this.isFlushing && this.pendingRequests.size === 0) {
        this.resolveCompletion?.(this.fullTranscript);
      }
    }
  }

  private encodeWAV(pcmBytes: Uint8Array, sampleRate: number): Blob {
    const dataLen = pcmBytes.byteLength;
    const buffer = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataLen, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);      // PCM
    view.setUint16(22, 1, true);      // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataLen, true);

    new Uint8Array(buffer, 44).set(pcmBytes);

    return new Blob([buffer], { type: 'audio/wav' });
  }
}
