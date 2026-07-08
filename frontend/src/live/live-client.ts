/**
 * Gemini Live API WebSocket Client
 *
 * 負責處理與 Google Gemini Live WebSocket 雙向串流連線 (PRD §8)
 */

export type SpeechProfile = 'auto' | 'cantonese' | 'cantonese-english' | 'english';

const BASE_TRANSCRIPTION_INSTRUCTION =
  "Transcribe the user's speech verbatim. Do not answer, do not translate, do not chat, do not explain. Just output the transcription of the audio content word for word.";

function buildTranscriptionInstruction(profile: SpeechProfile = 'auto'): string {
  if (profile === 'cantonese-english') {
    return `${BASE_TRANSCRIPTION_INSTRUCTION}\n\nThe user often speaks Cantonese-English code-switching from a Hong Kong Cantonese speaker. Transcribe Hong Kong Cantonese in Traditional Chinese with Hong Kong wording. Preserve English words, product names, app names, and technical terms in English. Do not translate English into Chinese. Do not convert Cantonese into Mandarin-style phrasing. Output only Traditional Chinese characters and English Latin-script words. Never output Japanese kana or Korean Hangul; if language detection is uncertain, prefer Hong Kong Traditional Chinese plus preserved English terms.`;
  }

  if (profile === 'cantonese') {
    return `${BASE_TRANSCRIPTION_INSTRUCTION}\n\nThe user speaks Hong Kong Cantonese. Transcribe Cantonese in Traditional Chinese with Hong Kong wording. Preserve English product names, app names, and technical terms in English. Do not convert Cantonese into Mandarin-style phrasing. Output only Traditional Chinese characters and English Latin-script words. Never output Japanese kana or Korean Hangul.`;
  }

  if (profile === 'english') {
    return `${BASE_TRANSCRIPTION_INSTRUCTION}\n\nThe user speaks English. Preserve English spelling, product names, app names, and technical terms exactly when possible.`;
  }

  return BASE_TRANSCRIPTION_INSTRUCTION;
}

export interface LiveClientConfig {
  token: string;
  model: string;
  speechProfile?: SpeechProfile;
  onTranscription: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  onClose: (code?: number, reason?: string) => void;
  onOpen?: () => void;
  onSetupComplete?: () => void;
  onAudioSent?: () => void;
}

type AudioMessage = {
  realtimeInput: {
    audio: {
      mimeType: string;
      data: string;
    };
  };
};

export class LiveClient {
  private ws: WebSocket | null = null;
  private config: LiveClientConfig;
  private isConnected = false;
  private isSetupComplete = false;
  private pendingAudioMessages: AudioMessage[] = [];
  private pendingAudioStreamEnd = false;
  private pendingAudioFrameBytes = new Uint8Array(0);
  // AudioWorklet commonly emits 128-frame render quanta. At 48kHz that is only
  // ~2.7ms before resampling. Sending one WebSocket message per quantum creates
  // thousands of tiny JSON/base64 frames, which is fragile on mobile networks and
  // can make Gemini's server buffer behave like it missed later speech. Aggregate
  // into ~100ms PCM frames: 16k samples/sec * 2 bytes/sample * 0.1 sec = 3200.
  private readonly targetAudioFrameBytes = 3200;
  // After aggregation, 60 pending frames is roughly 6s of setup buffer.
  private readonly maxPendingAudioMessages = 60;

  constructor(config: LiveClientConfig) {
    this.config = config;
  }

  /**
   * 建立 WebSocket 連線並發送 Setup 訊息
   */
  public connect() {
    try {
      const modelName = this.config.model;
      // Ephemeral tokens are only accepted by the constrained v1alpha endpoint.
      const baseUrl = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
      const wsUrl = `${baseUrl}?access_token=${encodeURIComponent(this.config.token)}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        if (this.config.onOpen) {
          this.config.onOpen();
        }
        this.sendSetupMessage(modelName);
      };

      this.ws.onmessage = (event) => {
        void this.handleMessage(event);
      };

      this.ws.onerror = (event) => {
        console.error("Gemini WS Error:", event);
        this.config.onError("WebSocket 發生錯誤，無法與 Gemini 保持連線");
      };

      this.ws.onclose = (event) => {
        this.resetConnectionState();
        console.log("Gemini WS Closed:", event);
        if (event.code !== 1000 && event.reason) {
          this.config.onError(`Gemini Live 連線關閉 (${event.code}): ${event.reason}`);
        }
        this.config.onClose(event.code, event.reason);
      };
    } catch (err: any) {
      this.config.onError(`連線初始化失敗: ${err.message || err}`);
    }
  }

  /**
   * 關閉 WebSocket 連線
   */
  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.resetConnectionState();
  }

  /**
   * 傳送原生 16kHz Little-endian PCM 音訊 chunk (Base64)
   * @param pcmBuffer ArrayBuffer (PCM Int16)
   */
  public sendAudioChunk(pcmBuffer: ArrayBuffer) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.appendAudioBytes(new Uint8Array(pcmBuffer));

    while (this.pendingAudioFrameBytes.byteLength >= this.targetAudioFrameBytes) {
      const frameBytes = this.pendingAudioFrameBytes.slice(0, this.targetAudioFrameBytes);
      this.pendingAudioFrameBytes = this.pendingAudioFrameBytes.slice(this.targetAudioFrameBytes);
      this.queueOrSendAudioBytes(frameBytes);
    }
  }

  private appendAudioBytes(bytes: Uint8Array) {
    const combined = new Uint8Array(this.pendingAudioFrameBytes.byteLength + bytes.byteLength);
    combined.set(this.pendingAudioFrameBytes, 0);
    combined.set(bytes, this.pendingAudioFrameBytes.byteLength);
    this.pendingAudioFrameBytes = combined;
  }

  private flushCurrentAudioFrame() {
    if (this.pendingAudioFrameBytes.byteLength === 0) {
      return;
    }
    this.queueOrSendAudioBytes(this.pendingAudioFrameBytes);
    this.pendingAudioFrameBytes = new Uint8Array(0);
  }

  private queueOrSendAudioBytes(bytes: Uint8Array) {
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    const message: AudioMessage = {
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: btoa(binary),
        },
      },
    };

    if (!this.isSetupComplete) {
      this.pendingAudioMessages.push(message);
      if (this.pendingAudioMessages.length > this.maxPendingAudioMessages) {
        this.pendingAudioMessages.shift();
      }
      return;
    }

    this.sendAudioMessage(message);
  }

  /**
   * 通知 Live API mic stream 已完結，讓 server 做 final VAD / transcription flush。
   */
  public sendAudioStreamEnd() {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.flushCurrentAudioFrame();

    if (!this.isSetupComplete) {
      this.pendingAudioStreamEnd = true;
      return;
    }

    this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  }

  /**
   * 送出初始化 Setup Message
   */
  private sendSetupMessage(model: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const setupMessage = {
      setup: {
        model: model,
        generationConfig: {
          // gemini-3.1-flash-live-preview rejects TEXT response modality with 1007.
          // We only need the input audio transcription; model audio output can be ignored.
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede",
              },
            },
          },
        },
        systemInstruction: {
          parts: [
            {
              text: buildTranscriptionInstruction(this.config.speechProfile),
            },
          ],
        },
        inputAudioTranscription: {},
      },
    };

    this.ws.send(JSON.stringify(setupMessage));
  }

  /**
   * 處理 WebSocket 接收到的即時訊息
   */
  private async handleMessage(event: MessageEvent) {
    try {
      const text = typeof event.data === 'string'
        ? event.data
        : await this.readMessageText(event.data);
      const response = JSON.parse(text);

      if (response.setupComplete) {
        this.isSetupComplete = true;
        this.config.onSetupComplete?.();
        this.flushPendingAudio();
        return;
      }

      // Gemini Live API response structure contains 'serverContent'.
      if (response.serverContent) {
        const { modelTurn, turnComplete, interrupted, inputTranscription } = response.serverContent;

        if (interrupted) {
          // 被打斷，通常在雙向語音時發生
          return;
        }

        // This is model output text. Kept for compatibility, but input speech
        // transcription is delivered separately as inputTranscription.
        if (modelTurn && modelTurn.parts) {
          for (const part of modelTurn.parts) {
            if (part.text) {
              this.config.onTranscription(part.text, turnComplete || false);
            }
          }
        }

        if (inputTranscription?.text) {
          this.config.onTranscription(inputTranscription.text, true);
        }
      }
    } catch (err) {
      console.error("Error parsing Gemini WS message:", err);
    }
  }

  private async readMessageText(data: MessageEvent['data']): Promise<string> {
    if (typeof data === 'string') {
      return data;
    }
    if (data instanceof Blob) {
      return await data.text();
    }
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }
    return String(data);
  }

  private flushPendingAudio() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    for (const message of this.pendingAudioMessages) {
      this.sendAudioMessage(message);
    }
    this.pendingAudioMessages = [];
    this.flushCurrentAudioFrame();

    if (this.pendingAudioStreamEnd) {
      this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      this.pendingAudioStreamEnd = false;
    }
  }

  private sendAudioMessage(message: AudioMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(message));
    this.config.onAudioSent?.();
  }

  private resetConnectionState() {
    this.isConnected = false;
    this.isSetupComplete = false;
    this.pendingAudioMessages = [];
    this.pendingAudioStreamEnd = false;
    this.pendingAudioFrameBytes = new Uint8Array(0);
  }
}
