import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveClient } from './live-client';

describe('LiveClient WebSockets Integration Tests', () => {
  let mockOnTranscription: any;
  let mockOnError: any;
  let mockOnClose: any;
  let mockOnOpen: any;
  let wsInstances: any[] = [];
  let lastMockSend: any;

  beforeEach(() => {
    wsInstances = [];
    lastMockSend = vi.fn();

    // Clean mock for global standard constructor in environment
    const mockWS = function (this: any, url: string) {
      this.url = url;
      this.readyState = 1; // Immediately OPEN to satisfy "WebSocket.OPEN" in WebSocket
      this.send = lastMockSend;
      this.close = vi.fn();
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      wsInstances.push(this);
    };
    // Ensure static properties like OPEN exist on our constructor mock
    (mockWS as any).OPEN = 1;

    if (typeof window !== 'undefined') {
      (window as any).WebSocket = mockWS;
    }

    mockOnTranscription = vi.fn();
    mockOnError = vi.fn();
    mockOnClose = vi.fn();
    mockOnOpen = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should construct and connect properly', () => {
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
      onOpen: mockOnOpen,
    });

    client.connect();

    expect(wsInstances.length).toBe(1);
    const ws = wsInstances[0];

    // Trigger onopen callback
    ws.readyState = 1; // OPEN
    if (ws.onopen) {
      ws.onopen();
    }

    expect(mockOnOpen).toHaveBeenCalled();
    expect(lastMockSend).toHaveBeenCalled();
    const sentData = JSON.parse(lastMockSend.mock.calls[0][0]);
    expect(sentData.setup.model).toBe('models/gemini-3.1-flash-live-preview');
  });

  it('should handle incoming transcription text blocks', () => {
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
    });

    client.connect();

    expect(wsInstances.length).toBe(1);
    const ws = wsInstances[0];

    // Simulate real-time server transcription data event response payload
    if (ws.onmessage) {
      ws.onmessage({
        data: JSON.stringify({
          serverContent: {
            modelTurn: {
              parts: [{ text: 'Hello, testing Gemini Live' }],
            },
            turnComplete: false,
          },
        }),
      } as MessageEvent);
    }

    expect(mockOnTranscription).toHaveBeenCalledWith('Hello, testing Gemini Live', false);
  });

  it('should send binary Int16 little-endian PCM audio bytes chunk encoded as base64', () => {
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
    });

    client.connect();

    expect(wsInstances.length).toBe(1);
    const ws = wsInstances[0];
    
    // Simulate open state
    ws.readyState = 1; // OPEN
    if (ws.onopen) {
      ws.onopen();
    }

    const testPCMBuffer = new Int16Array([100, -100, 300, -300]).buffer;
    client.sendAudioChunk(testPCMBuffer);

    // Expect 2 send calls: Setup config message, and the Audio media chunk message
    expect(lastMockSend).toHaveBeenCalledTimes(2);
    
    const sentData = JSON.parse(lastMockSend.mock.calls[1][0]);
    expect(sentData.realtimeInput.mediaChunks[0].mimeType).toBe('audio/pcm;rate=16000');
    expect(sentData.realtimeInput.mediaChunks[0].data).toBeDefined();
    expect(typeof sentData.realtimeInput.mediaChunks[0].data).toBe('string');
  });
});
