/**
 * Gemini Live API WebSocket Client
 * 
 * 負責處理與 Google Gemini Live WebSocket 雙向串流連線 (PRD §8)
 */

export interface LiveClientConfig {
  token: string;
  model: string;
  onTranscription: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  onClose: () => void;
  onOpen?: () => void;
}

export class LiveClient {
  private ws: WebSocket | null = null;
  private config: LiveClientConfig;
  private isConnected = false;

  constructor(config: LiveClientConfig) {
    this.config = config;
  }

  /**
   * 建立 WebSocket 連線並發送 Setup 訊息
   */
  public connect() {
    try {
      const modelName = this.config.model;
      // Google Gemini Live WebSocket URL format:
      // wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent
      // With ephemeral token sent via bearer query parameter or header (API key matches query param, bearer is standard)
      const baseUrl = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";
      const wsUrl = `${baseUrl}?key=${this.config.token}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        if (this.config.onOpen) {
          this.config.onOpen();
        }
        this.sendSetupMessage(modelName);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.ws.onerror = (event) => {
        console.error("Gemini WS Error:", event);
        this.config.onError("WebSocket 發生錯誤，無法與 Gemini 保持連線");
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        console.log("Gemini WS Closed:", event);
        this.config.onClose();
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
    this.isConnected = false;
  }

  /**
   * 傳送原生 16kHz Little-endian PCM 音訊 chunk (Base64)
   * @param pcmBuffer ArrayBuffer (PCM Int16)
   */
  public sendAudioChunk(pcmBuffer: ArrayBuffer) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Convert ArrayBuffer to Base64 string
    const bytes = new Uint8Array(pcmBuffer);
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Data = btoa(binary);

    // Build real-time input message format
    const message = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "audio/pcm;rate=16000",
            data: base64Data
          }
        ]
      }
    };

    this.ws.send(JSON.stringify(message));
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
          responseModalities: ["TEXT"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede" // 預設聲音，雖然我們只拿 TEXT
              }
            }
          }
        },
        systemInstruction: {
          parts: [
            {
              text: "Transcribe the user's speech verbatim. Do not answer, do not translate, do not chat, do not explain. Just output the transcription of the audio content word for word."
            }
          ]
        }
      }
    };

    this.ws.send(JSON.stringify(setupMessage));
  }

  /**
   * 處理 WebSocket 接收到的即時訊息
   */
  private handleMessage(event: MessageEvent) {
    try {
      const response = JSON.parse(event.data);

      // Gemini Live API response structure contains 'serverContent'
      if (response.serverContent) {
        const { modelTurn, turnComplete, interrupted } = response.serverContent;

        if (interrupted) {
          // 被打斷，通常在雙向語音時發生
          return;
        }

        if (modelTurn && modelTurn.parts) {
          for (const part of modelTurn.parts) {
            if (part.text) {
              // 獲取部分聽寫內容，傳遞給前端 UI
              this.config.onTranscription(part.text, turnComplete || false);
            }
          }
        }
      }
    } catch (err) {
      console.error("Error parsing Gemini WS message:", err);
    }
  }
}
