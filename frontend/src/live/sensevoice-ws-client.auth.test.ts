import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SenseVoiceWsClient } from './sensevoice-ws-client';

/**
 * Auth-token behavior for the SenseVoice v2 WS client.
 *
 * The browser cannot attach arbitrary WebSocket headers, so the client first
 * POSTs the token endpoint, then appends the URL-encoded token as a query
 * parameter to the v2 WS URL. These tests assert:
 *  - a successful token fetch produces a WS URL with the encoded token appended
 *  - the token/URL are never logged
 *  - a token-fetch failure surfaces a safe error and never opens a socket
 */
describe('SenseVoiceWsClient — auth token', () => {
  let wsInstances: any[] = [];

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches a token then opens the v2 WS URL with the URL-encoded token query param', async () => {
    const rawToken = 'abc.def+/=';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: rawToken, expiresAt: 2000000000 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const client = new SenseVoiceWsClient({
      wsUrl: 'wss://example.com/ws/transcribe-v2',
      tokenUrl: '/api/sensevoice-token',
      language: 'yue',
      onTranscription: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    });

    await client.connect();

    expect(fetchMock).toHaveBeenCalledWith('/api/sensevoice-token', { method: 'POST' });
    expect(wsInstances).toHaveLength(1);
    const openedUrl: string = wsInstances[0].url;
    expect(openedUrl).toContain('wss://example.com/ws/transcribe-v2?token=');
    expect(openedUrl).toContain(encodeURIComponent(rawToken));
    // Raw token must not be logged, and the full URL (which carries the token)
    // must not be logged either.
    for (const spy of [logSpy, errSpy]) {
      for (const call of spy.mock.calls) {
        const joined = call.map((c) => String(c)).join(' ');
        expect(joined).not.toContain(rawToken);
        expect(joined).not.toContain('token=');
      }
    }
  });

  it('surfaces a safe error and never opens a socket when the token fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const onError = vi.fn();

    const client = new SenseVoiceWsClient({
      wsUrl: 'wss://example.com/ws/transcribe-v2',
      tokenUrl: '/api/sensevoice-token',
      language: 'yue',
      onTranscription: vi.fn(),
      onError,
      onClose: vi.fn(),
    });

    await client.connect();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(wsInstances).toHaveLength(0);
    // The error message must not leak any token material.
    const msg = String(onError.mock.calls[0][0]);
    expect(msg).not.toContain('token=');
  });
});
