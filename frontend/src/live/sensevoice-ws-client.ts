/**
 * SenseVoice WebSocket Client (VAD-based)
 *
 * 取代 HTTP polling 版本。
 * 前端連 WebSocket，持續送 raw PCM Int16，後端 FSMN-VAD 自動偵測語音邊界，
 * 有完整語音段時才觸發 SenseVoice 識別並 push transcript 回來。
 *
 * 同 SenseVoiceClient 保持相同 public interface，App.tsx 唔需大改。
 */

export interface SenseVoiceWsClientConfig {
  wsUrl: string;          // e.g. wss://your-sensevoice-host/ws/transcribe-v2
  language: string;       // 'yue' | 'zh' | 'auto'
  sampleRate?: number;    // PCM sample rate from AudioWorklet (default 16000)
  onTranscription: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  onClose: (code?: number, reason?: string) => void;
  onOpen?: () => void;
  onAudioSent?: () => void;  // called each time a PCM chunk is sent
  onEndSent?: () => void;
  onEndAck?: () => void;
}

const TARGET_CHUNK_BYTES = 3200; // 100ms of 16kHz 16-bit mono PCM

export class SenseVoiceWsClient {
  private config: SenseVoiceWsClientConfig;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private resolveCompletion: ((text: string) => void) | null = null;
  private completionPromise: Promise<string> | null = null;
  private fullTranscript = '';
  private endAckReceived = false;
  private endSent = false;
  private pendingAudio = new Uint8Array(0);
  private readonly targetChunkBytes = TARGET_CHUNK_BYTES;

  constructor(config: SenseVoiceWsClientConfig) {
    this.config = { sampleRate: 16000, ...config };
  }

  /** 開啟 WebSocket 連線 */
  connect() {
    this.fullTranscript = '';
    this.endAckReceived = false;
    this.endSent = false;
    this.pendingAudio = new Uint8Array(0);
    this.completionPromise = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });

    const ws = new WebSocket(this.config.wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.isConnected = true;
      // 告訴後端語言
      ws.send(`LANG:${this.config.language}`);
      this.config.onOpen?.();
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data as string) as {
          transcript?: string;
          is_final?: boolean;
          end_ack?: boolean;
          error?: string;
        };
        if (data.error) {
          this.config.onError(`SenseVoice WS 錯誤: ${data.error}`);
          return;
        }
        if (data.end_ack) {
          this.endAckReceived = true;
          this.config.onEndAck?.();
          this.resolveCompletion?.(this.fullTranscript);
          return;
        }
        const text = data.transcript ?? '';
        const isFinal = data.is_final ?? true;
        if (text.trim()) {
          if (isFinal) {
            this.fullTranscript += text;
          }
          this.config.onTranscription(text, isFinal);
        }
      } catch {
        // ignore non-JSON frames
      }
    };

    ws.onerror = () => {
      this.config.onError('SenseVoice WebSocket 連線錯誤');
    };

    ws.onclose = (evt) => {
      this.isConnected = false;
      // If END ack not received yet (e.g. connection dropped), resolve anyway
      if (!this.endAckReceived) {
        this.resolveCompletion?.(this.fullTranscript);
      }
      this.config.onClose(evt.code, evt.reason);
    };
  }

  /**
   * 接收從 AudioWorklet 嚟嘅 PCM Int16 chunk，直接送到後端。
   * 唔需要 WAV header，後端 VAD 自己決定幾時切。
   */
  sendAudioChunk(pcmBuffer: ArrayBuffer) {
    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) return;
    const incoming = new Uint8Array(pcmBuffer);
    const merged = new Uint8Array(this.pendingAudio.length + incoming.length);
    merged.set(this.pendingAudio);
    merged.set(incoming, this.pendingAudio.length);
    this.pendingAudio = merged;
    this.flushAudioBuffer(false);
  }

  private flushAudioBuffer(force: boolean) {
    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) return;
    const flushBytes = force
      ? this.pendingAudio.length
      : Math.floor(this.pendingAudio.length / this.targetChunkBytes) * this.targetChunkBytes;
    if (flushBytes <= 0) return;

    let offset = 0;
    while (offset < flushBytes) {
      const end = Math.min(offset + this.targetChunkBytes, flushBytes);
      const chunk = this.pendingAudio.slice(offset, end);
      this.ws!.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
      this.config.onAudioSent?.();
      offset = end;
    }

    this.pendingAudio = this.pendingAudio.slice(flushBytes);
  }

  /** 通知音訊結束，後端 flush 剩餘 buffer */
  sendAudioStreamEnd() {
    if (this.endSent) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.flushAudioBuffer(true);
      this.ws.send('END');
      this.endSent = true;
      this.config.onEndSent?.();
    } else {
      // WS already closed, resolve immediately
      this.resolveCompletion?.(this.fullTranscript);
    }
  }

  /** 等後端 flush 完並確認，回傳完整 transcript */
  async waitForCompletion(): Promise<string> {
    if (!this.completionPromise) return this.fullTranscript;
    // Timeout safety: resolve after 8s regardless
    const timeout = new Promise<string>((res) =>
      setTimeout(() => res(this.fullTranscript), 8000),
    );
    return Promise.race([this.completionPromise, timeout]);
  }

  /** 強制關閉連線 */
  disconnect() {
    this.isConnected = false;
    this.resolveCompletion?.(this.fullTranscript);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      this.ws.close(1000, 'disconnected');
    }
    this.ws = null;
  }
}
