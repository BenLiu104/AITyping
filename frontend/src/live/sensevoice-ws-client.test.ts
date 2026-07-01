import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SenseVoiceWsClient } from './sensevoice-ws-client';

describe('SenseVoiceWsClient', () => {
  let wsInstances: any[] = [];
  let mockOnTranscription: any;
  let mockOnError: any;
  let mockOnClose: any;
  let mockOnOpen: any;

  beforeEach(() => {
    wsInstances = [];
    const mockWS = function (this: any, url: string) {
      const instance = this as any;
      instance.url = url;
      instance.readyState = 1;
      instance.send = vi.fn();
      instance.close = vi.fn();
      instance.onopen = null;
      instance.onmessage = null;
      instance.onerror = null;
      instance.onclose = null;
      wsInstances.push(instance);
    };
    (mockWS as any).OPEN = 1;
    (window as any).WebSocket = mockWS;

    mockOnTranscription = vi.fn();
    mockOnError = vi.fn();
    mockOnClose = vi.fn();
    mockOnOpen = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves only final transcript content on end_ack and ignores partial duplication', async () => {
    const client = new SenseVoiceWsClient({
      wsUrl: 'wss://example.com/ws/transcribe-v2',
      language: 'auto',
      onTranscription: mockOnTranscription,
      onError: mockOnError,
      onClose: mockOnClose,
      onOpen: mockOnOpen,
    });

    client.connect();
    const ws = wsInstances[0];
    ws.onopen?.();

    ws.onmessage?.({ data: JSON.stringify({ transcript: '呢几个字', is_final: false }) } as MessageEvent);
    ws.onmessage?.({ data: JSON.stringify({ transcript: '呢几个字都表达唔到，我想讲嘅意思。', is_final: true }) } as MessageEvent);
    ws.onmessage?.({ data: JSON.stringify({ end_ack: true }) } as MessageEvent);

    await expect(client.waitForCompletion()).resolves.toBe('呢几个字都表达唔到，我想讲嘅意思。');
    expect(mockOnTranscription).toHaveBeenNthCalledWith(1, '呢几个字', false);
    expect(mockOnTranscription).toHaveBeenNthCalledWith(2, '呢几个字都表达唔到，我想讲嘅意思。', true);
  });
});
