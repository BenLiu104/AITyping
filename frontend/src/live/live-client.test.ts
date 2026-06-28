import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveClient } from './live-client';

describe('LiveClient WebSockets Integration Tests', () => {
  let mockOnTranscription: any;
  let mockOnError: any;
  let mockOnClose: any;
  let mockOnOpen: any;
  let mockOnAudioSent: any;
  let wsInstances: any[] = [];
  let lastMockSend: any;

  beforeEach(() => {
    wsInstances = [];
    lastMockSend = vi.fn();

    const mockWS = function (this: any, url: string) {
      const instance = this as any;
      instance.url = url;
      instance.readyState = 1;
      instance.send = lastMockSend;
      instance.close = vi.fn();
      instance.onopen = null;
      instance.onmessage = null;
      instance.onerror = null;
      instance.onclose = null;
      wsInstances.push(instance);
    };
    (mockWS as any).OPEN = 1;

    if (typeof window !== 'undefined') {
      (window as any).WebSocket = mockWS;
    }

    mockOnTranscription = vi.fn();
    mockOnError = vi.fn();
    mockOnClose = vi.fn();
    mockOnOpen = vi.fn();
    mockOnAudioSent = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should construct and connect with a Live-compatible setup message', () => {
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
    expect(ws.url).toContain('google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent');

    ws.readyState = 1;
    ws.onopen?.();

    expect(mockOnOpen).toHaveBeenCalled();
    expect(lastMockSend).toHaveBeenCalledTimes(1);
    const sentData = JSON.parse(lastMockSend.mock.calls[0][0]);
    expect(sentData.setup.model).toBe('models/gemini-3.1-flash-live-preview');
    expect(sentData.setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(sentData.setup.inputAudioTranscription).toEqual({});
  });

  it('should notify when Live setup is complete', () => {
    const mockOnSetupComplete = vi.fn();
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
      onSetupComplete: mockOnSetupComplete,
    });

    client.connect();
    const ws = wsInstances[0];
    ws.readyState = 1;
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) } as MessageEvent);

    expect(mockOnSetupComplete).toHaveBeenCalledTimes(1);
  });

  it('should parse Blob WebSocket messages from browser implementations', async () => {
    const mockOnSetupComplete = vi.fn();
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
      onSetupComplete: mockOnSetupComplete,
    });

    client.connect();
    const ws = wsInstances[0];
    ws.readyState = 1;
    ws.onopen?.();
    ws.onmessage?.({ data: new Blob([JSON.stringify({ setupComplete: {} })]) } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockOnSetupComplete).toHaveBeenCalledTimes(1);
  });

  it('should buffer audio chunks until setupComplete, then flush them in order', () => {
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
      onAudioSent: mockOnAudioSent,
    });

    client.connect();
    const ws = wsInstances[0];
    ws.readyState = 1;
    ws.onopen?.();

    client.sendAudioChunk(new Int16Array([100]).buffer);
    expect(lastMockSend).toHaveBeenCalledTimes(1);

    ws.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) } as MessageEvent);
    client.sendAudioChunk(new Int16Array([200]).buffer);

    expect(lastMockSend).toHaveBeenCalledTimes(3);
    const firstAudio = JSON.parse(lastMockSend.mock.calls[1][0]);
    const secondAudio = JSON.parse(lastMockSend.mock.calls[2][0]);
    expect(firstAudio.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(secondAudio.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(mockOnAudioSent).toHaveBeenCalledTimes(2);
  });

  it('should keep only a bounded setup buffer before setupComplete', () => {
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
    });

    client.connect();
    const ws = wsInstances[0];
    ws.readyState = 1;
    ws.onopen?.();

    for (let i = 0; i < 2100; i++) {
      client.sendAudioChunk(new Int16Array([i]).buffer);
    }
    expect(lastMockSend).toHaveBeenCalledTimes(1);

    ws.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) } as MessageEvent);

    expect(lastMockSend).toHaveBeenCalledTimes(2001);
  });

  it('should defer audioStreamEnd until setupComplete if the user releases early', () => {
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
    });

    client.connect();
    const ws = wsInstances[0];
    ws.readyState = 1;
    ws.onopen?.();

    client.sendAudioChunk(new Int16Array([100]).buffer);
    client.sendAudioStreamEnd();
    expect(lastMockSend).toHaveBeenCalledTimes(1);

    ws.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) } as MessageEvent);

    expect(lastMockSend).toHaveBeenCalledTimes(3);
    expect(JSON.parse(lastMockSend.mock.calls[2][0])).toEqual({ realtimeInput: { audioStreamEnd: true } });
  });

  it('should handle incoming model text blocks', () => {
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
    });

    client.connect();
    const ws = wsInstances[0];

    ws.onmessage?.({
      data: JSON.stringify({
        serverContent: {
          modelTurn: {
            parts: [{ text: 'Hello, testing Gemini Live' }],
          },
          turnComplete: false,
        },
      }),
    } as MessageEvent);

    expect(mockOnTranscription).toHaveBeenCalledWith('Hello, testing Gemini Live', false);
  });

  it('should handle Gemini input audio transcription events', () => {
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
    });

    client.connect();
    const ws = wsInstances[0];

    ws.onmessage?.({
      data: JSON.stringify({
        serverContent: {
          inputTranscription: { text: '今日天氣很好' },
        },
      }),
    } as MessageEvent);

    expect(mockOnTranscription).toHaveBeenCalledWith('今日天氣很好', true);
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

    ws.readyState = 1;
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) } as MessageEvent);

    const testPCMBuffer = new Int16Array([100, -100, 300, -300]).buffer;
    client.sendAudioChunk(testPCMBuffer);

    expect(lastMockSend).toHaveBeenCalledTimes(2);

    const sentData = JSON.parse(lastMockSend.mock.calls[1][0]);
    expect(sentData.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(sentData.realtimeInput.audio.data).toBeDefined();
    expect(typeof sentData.realtimeInput.audio.data).toBe('string');
  });

  it('should send audio stream end before closing push-to-talk capture', () => {
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
    });

    client.connect();
    const ws = wsInstances[0];
    ws.readyState = 1;
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) } as MessageEvent);

    client.sendAudioStreamEnd();

    const sentData = JSON.parse(lastMockSend.mock.calls[1][0]);
    expect(sentData).toEqual({ realtimeInput: { audioStreamEnd: true } });
  });

  it('should report WebSocket close code and reason', () => {
    const client = new LiveClient({
      token: 'test_token',
      model: 'models/gemini-3.1-flash-live-preview',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
    });

    client.connect();
    const ws = wsInstances[0];
    ws.onclose?.({ code: 1006, reason: 'network lost' } as CloseEvent);

    expect(mockOnClose).toHaveBeenCalledWith(1006, 'network lost');
  });
});
