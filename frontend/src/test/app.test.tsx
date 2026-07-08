import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import App from '../App'

const liveClientMockState = vi.hoisted(() => ({
  latestConfig: undefined as any,
  latestClient: undefined as any,
}))

const senseVoiceClientMockState = vi.hoisted(() => ({
  latestConfig: undefined as any,
  latestClient: undefined as any,
}))

vi.mock('../live/live-client', () => ({
  LiveClient: class {
    constructor(config: any) {
      liveClientMockState.latestConfig = config
      liveClientMockState.latestClient = {
        connect: vi.fn(() => config.onOpen?.()),
        sendAudioChunk: vi.fn(),
        sendAudioStreamEnd: vi.fn(),
        disconnect: vi.fn(),
        emitSetupComplete: vi.fn(() => config.onSetupComplete?.()),
        emitError: vi.fn((message: string) => config.onError?.(message)),
      }
      return liveClientMockState.latestClient
    }
  },
}))

vi.mock('../live/sensevoice-ws-client', () => ({
  SenseVoiceWsClient: class {
    constructor(config: any) {
      senseVoiceClientMockState.latestConfig = config
      senseVoiceClientMockState.latestClient = {
        connect: vi.fn(() => config.onOpen?.()),
        sendAudioChunk: vi.fn(),
        sendAudioStreamEnd: vi.fn(() => config.onEndSent?.()),
        disconnect: vi.fn(),
        waitForCompletion: vi.fn().mockResolvedValue(''),
        emitEndAck: vi.fn(() => config.onEndAck?.()),
      }
      return senseVoiceClientMockState.latestClient
    }
  },
}))

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockImplementation(() => Promise.resolve()),
  },
})

// Mock vibration API
Object.assign(navigator, {
  vibrate: vi.fn(),
})

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const mockBrowserAudioPipeline = () => {
  const stop = vi.fn()
  const stream = {
    getTracks: () => [{ stop }],
  }
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })

  const mockWorkletNode = {
    port: { onmessage: null as ((event: MessageEvent) => void) | null },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }

  class MockAudioWorkletNode {
    port = mockWorkletNode.port
    connect = mockWorkletNode.connect
    disconnect = mockWorkletNode.disconnect
  }

  class MockAudioContext {
    sampleRate = 48000
    state = 'running'
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
    resume = vi.fn().mockResolvedValue(undefined)
    close = vi.fn().mockResolvedValue(undefined)
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }))
  }

  vi.stubGlobal('AudioContext', MockAudioContext)
  vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)

  return { getUserMedia, stop, mockWorkletNode }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
  liveClientMockState.latestConfig = undefined
  liveClientMockState.latestClient = undefined
  senseVoiceClientMockState.latestConfig = undefined
  senseVoiceClientMockState.latestClient = undefined
})

describe('App Component Core UI Tests', () => {
  it('renders app title correctly', () => {
    render(<App />)
    expect(screen.getByText('AITyping')).toBeInTheDocument()
  })

  it('primes mic permission on the first press without starting a stuck recording', async () => {
    const stop = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop }],
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(liveClientMockState.latestClient).toBeUndefined()
    expect(screen.queryByText(/RECORDING/i)).not.toBeInTheDocument()
    expect(screen.getByText(/麥克風已授權，請重新點一下開始錄音/i)).toBeInTheDocument()
  })

  it('ignores stale localStorage permission and primes mic on the first press of each page session', async () => {
    window.localStorage.setItem('aityping:mic-permission-primed', 'true')
    const stop = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop }],
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(liveClientMockState.latestClient).toBeUndefined()
    expect(screen.queryByText(/RECORDING/i)).not.toBeInTheDocument()
    expect(screen.getByText(/麥克風已授權，請重新點一下開始錄音/i)).toBeInTheDocument()
  })

  it('starts real mic capture only after mic permission is primed in the current page session', async () => {
    const stop = vi.fn()
    const callOrder: string[] = []
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce({
        getTracks: () => [{ stop }],
      })
      .mockImplementationOnce(() => {
        callOrder.push('mic')
        return new Promise(() => undefined)
      })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callOrder.push('fetch')
      return Promise.resolve({
        ok: true,
        json: async () => ({ token: 'test-token', model: 'models/test-live' }),
      })
    }))

    render(<App />)

    expect(screen.queryByText('MOCK')).not.toBeInTheDocument()

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    expect(stop).toHaveBeenCalled()
    expect(callOrder).toEqual([])

    await act(async () => {
      fireEvent.pointerDown(micButton)
    })

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    expect(callOrder).toEqual(['mic'])
    expect(screen.queryByText(/正在聽寫\.\.\./i)).not.toBeInTheDocument()
  })

  it('uses SenseVoice for Cantonese/mixed and LiveClient for English', async () => {
    mockBrowserAudioPipeline()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'test-token', model: 'models/gemini-3.1-flash-live-preview' }),
    }))

    render(<App />)

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    // Default is 'mixed' → SenseVoiceClient
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    expect(senseVoiceClientMockState.latestConfig).toBeTruthy()
    expect(senseVoiceClientMockState.latestConfig.wsUrl).toContain('/ws/transcribe-v2')
    expect(senseVoiceClientMockState.latestConfig.language).toBe('auto')
    expect(senseVoiceClientMockState.latestClient).toBeTruthy()
  })

  it('passes yue language to SenseVoice when Cantonese is selected', async () => {
    mockBrowserAudioPipeline()

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /設定/i }))
    const languageSelect = screen.getByDisplayValue(/中英混合/i)
    fireEvent.change(languageSelect, { target: { value: 'yue' } })

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    expect(senseVoiceClientMockState.latestConfig.language).toBe('yue')
  })

  it('passes English speech profile to LiveClient when language is English', async () => {
    mockBrowserAudioPipeline()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'test-token', model: 'models/gemini-3.1-flash-live-preview' }),
    }))

    render(<App />)

    // Switch language to English first
    fireEvent.click(screen.getByRole('button', { name: /設定/i }))
    const languageSelect = screen.getByDisplayValue(/中英混合/i)
    fireEvent.change(languageSelect, { target: { value: 'en' } })

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    expect(liveClientMockState.latestConfig.speechProfile).toBe('english')
  })

  it('shows a safe error when Gemini Live token creation fails without frontend key fallback', async () => {
    mockBrowserAudioPipeline()

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ detail: 'unsafe backend detail should not be displayed' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    fireEvent.change(screen.getByLabelText('語言模式'), { target: { value: 'en' } })

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/live-token', { method: 'POST' })
    expect(liveClientMockState.latestClient).toBeUndefined()
    expect(screen.getByText('無法建立 Gemini Live 安全連線，請稍後再試')).toBeInTheDocument()
    expect(screen.queryByText(/unsafe backend detail/i)).not.toBeInTheDocument()
  })

  it('cleans up Live input transcription after push-to-talk release', async () => {
    vi.useFakeTimers()
    window.localStorage.setItem('aityping:mic-permission-primed', 'true')
    mockBrowserAudioPipeline()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'test-token', model: 'models/gemini-3.1-flash-live-preview' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cleaned: '整理後文字' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    // Switch to English so LiveClient is used
    fireEvent.click(screen.getByRole('button', { name: /設定/i }))
    const languageSelect = screen.getByDisplayValue(/中英混合/i)
    fireEvent.change(languageSelect, { target: { value: 'en' } })
    // Default mode is now 'semantic'; select 'message' to exercise /api/cleanup.
    fireEvent.change(screen.getByLabelText('整理模式'), { target: { value: 'message' } })

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    await act(async () => {
      liveClientMockState.latestConfig.onTranscription('今日天氣很好', true)
    })
    expect(screen.getByText('今日天氣很好')).toBeInTheDocument()

    await act(async () => {
      fireEvent.pointerDown(micButton)
      await vi.advanceTimersByTimeAsync(700)
      await flushPromises()
    })

    expect(liveClientMockState.latestClient.sendAudioStreamEnd).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/debug-event', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('transcript-ready'),
    }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/cleanup', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('今日天氣很好'),
    }))

    const textarea = screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement
    expect(textarea.value).toBe('整理後文字')
  })

  it('uses tap-to-toggle recording: release keeps recording and the next tap stops', async () => {
    vi.useFakeTimers()
    mockBrowserAudioPipeline()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'test-token', model: 'models/gemini-3.1-flash-live-preview' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cleaned: '整理後文字' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    // Switch to English so LiveClient is used
    fireEvent.click(screen.getByRole('button', { name: /設定/i }))
    const languageSelect = screen.getByDisplayValue(/中英混合/i)
    fireEvent.change(languageSelect, { target: { value: 'en' } })
    // Default mode is now 'semantic'; select 'message' to exercise /api/cleanup.
    fireEvent.change(screen.getByLabelText('整理模式'), { target: { value: 'message' } })

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    expect(screen.getByText(/麥克風已授權，請重新點一下開始錄音/i)).toBeInTheDocument()

    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    expect(screen.getByText(/RECORDING/i)).toBeInTheDocument()

    await act(async () => {
      liveClientMockState.latestConfig.onTranscription('今日天氣很好', true)
      fireEvent.pointerUp(micButton)
      await vi.advanceTimersByTimeAsync(700)
      await flushPromises()
    })

    expect(screen.getByText(/RECORDING/i)).toBeInTheDocument()
    expect(liveClientMockState.latestClient.sendAudioStreamEnd).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/cleanup', expect.anything())

    await act(async () => {
      fireEvent.pointerDown(micButton)
      await vi.advanceTimersByTimeAsync(700)
      await flushPromises()
    })

    expect(liveClientMockState.latestClient.sendAudioStreamEnd).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/cleanup', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('今日天氣很好'),
    }))
  })

  it('does not show a late WebSocket error after Live transcription already arrived', async () => {
    vi.useFakeTimers()
    mockBrowserAudioPipeline()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'test-token', model: 'models/gemini-3.1-flash-live-preview' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cleaned: '整理後文字' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    // Switch to English so LiveClient is used
    fireEvent.click(screen.getByRole('button', { name: /設定/i }))
    const languageSelect = screen.getByDisplayValue(/中英混合/i)
    fireEvent.change(languageSelect, { target: { value: 'en' } })
    // Default mode is now 'semantic'; select 'message' to exercise /api/cleanup.
    fireEvent.change(screen.getByLabelText('整理模式'), { target: { value: 'message' } })

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    await act(async () => {
      liveClientMockState.latestConfig.onTranscription('今日天氣很好', true)
      liveClientMockState.latestClient.emitError('WebSocket 發生錯誤，無法與 Gemini 保持連線')
      await flushPromises()
    })

    expect(screen.queryByText('WebSocket 發生錯誤，無法與 Gemini 保持連線')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.pointerDown(micButton)
      await vi.advanceTimersByTimeAsync(700)
      await flushPromises()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/debug-event', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('WebSocket 發生錯誤'),
    }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/cleanup', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('今日天氣很好'),
    }))

    const textarea = screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement
    expect(textarea.value).toBe('整理後文字')
  })

  it('does not send status text to cleanup when Live returns no transcription', async () => {
    vi.useFakeTimers()
    window.localStorage.setItem('aityping:mic-permission-primed', 'true')
    mockBrowserAudioPipeline()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'test-token', model: 'models/gemini-3.1-flash-live-preview' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    // Switch to English so LiveClient is used
    fireEvent.click(screen.getByRole('button', { name: /設定/i }))
    const languageSelect = screen.getByDisplayValue(/中英混合/i)
    fireEvent.change(languageSelect, { target: { value: 'en' } })

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    expect(screen.getByText(/Live API 已連線，正在準備聽寫/i)).toBeInTheDocument()
    expect(screen.queryByText(/連線成功，請開始說話/i)).not.toBeInTheDocument()

    await act(async () => {
      liveClientMockState.latestClient.emitSetupComplete()
    })
    expect(screen.getByText(/連線成功，請開始說話/i)).toBeInTheDocument()

    await act(async () => {
      fireEvent.pointerDown(micButton)
      await vi.advanceTimersByTimeAsync(4500)
      await flushPromises()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith('/api/live-token', { method: 'POST' })
    const debugCall = fetchMock.mock.calls.find(([url]) => url === '/api/debug-event')
    expect(debugCall).toBeTruthy()
    const debugBody = JSON.parse(debugCall![1].body as string)
    expect(debugBody).toMatchObject({
      phase: 'no-transcript',
      build: expect.any(String),
      wsOpen: true,
      setupComplete: true,
      transcriptEvents: 0,
    })
    expect(JSON.stringify(debugBody)).not.toContain('今日天氣很好')
    expect(screen.getByText(/未收到聽寫文字/i)).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('shows finalized and interim SenseVoice transcript together while recording', async () => {
    window.localStorage.setItem('aityping:mic-permission-primed', 'true')
    mockBrowserAudioPipeline()

    render(<App />)

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    await act(async () => {
      senseVoiceClientMockState.latestConfig.onTranscription('第一句。', true)
      senseVoiceClientMockState.latestConfig.onTranscription('第二句未完', false)
    })

    expect(screen.getByText('第一句。第二句未完')).toBeInTheDocument()
  })

  it('falls back to visible SenseVoice transcript for cleanup when waitForCompletion resolves empty', async () => {
    window.localStorage.setItem('aityping:mic-permission-primed', 'true')
    mockBrowserAudioPipeline()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cleaned: '整理後文字' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    // Default mode is now 'semantic'; select 'message' to exercise /api/cleanup.
    fireEvent.change(screen.getByLabelText('整理模式'), { target: { value: 'message' } })

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    await act(async () => {
      senseVoiceClientMockState.latestConfig.onTranscription('第一句。', true)
      senseVoiceClientMockState.latestConfig.onTranscription('第二句未完', false)
      await flushPromises()
    })

    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    expect(senseVoiceClientMockState.latestClient.sendAudioStreamEnd).toHaveBeenCalled()
    expect(senseVoiceClientMockState.latestClient.waitForCompletion).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/cleanup', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('第一句。第二句未完'),
    }))

    const textarea = screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement
    expect(textarea.value).toBe('整理後文字')
  })

  it('marks SenseVoice END sent and acked in debug output', async () => {
    window.localStorage.setItem('aityping:mic-permission-primed', 'true')
    mockBrowserAudioPipeline()

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cleaned: '整理後文字' }),
      }))

    render(<App />)

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    await act(async () => {
      senseVoiceClientMockState.latestConfig.onTranscription('第一句。', true)
      fireEvent.pointerDown(micButton)
      senseVoiceClientMockState.latestClient.emitEndAck()
      await flushPromises()
    })

    expect(screen.getByText(/end=1 ack=1/)).toBeInTheDocument()
  })

  it('toggles settings menu when sliders button is clicked', async () => {
    render(<App />)

    const settingsButton = screen.getByRole('button', { name: /設定/i })
    expect(settingsButton).toBeInTheDocument()

    // Mode/language selectors now live on the main screen (always visible);
    // the settings drawer holds mock + haptics only. Assert on a drawer-only
    // string to verify the open/close toggle still works.
    expect(screen.queryByText('沙盒/模擬模式')).not.toBeInTheDocument()

    fireEvent.click(settingsButton)
    expect(screen.getByText('沙盒/模擬模式')).toBeInTheDocument()

    fireEvent.click(settingsButton)
    expect(screen.queryByText('沙盒/模擬模式')).not.toBeInTheDocument()
  })

  it('lets the settings checkboxes toggle options', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /設定/i }))

    const mockToggle = screen.getByRole('checkbox', { name: /切換沙盒模擬模式/i }) as HTMLInputElement
    const hapticsToggle = screen.getByRole('checkbox', { name: /切換觸覺震動回饋/i }) as HTMLInputElement

    expect(mockToggle.checked).toBe(false)
    expect(hapticsToggle.checked).toBe(true)

    fireEvent.click(mockToggle)
    fireEvent.click(hapticsToggle)

    expect(mockToggle.checked).toBe(true)
    expect(hapticsToggle.checked).toBe(false)
  })

  it('runs mock recording pipeline on mic button push and release', async () => {
    vi.useFakeTimers()
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /設定/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /切換沙盒模擬模式/i }))

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    expect(micButton).toBeInTheDocument()

    await act(async () => {
      fireEvent.pointerDown(micButton)
    })

    expect(screen.getByText(/RECORDING/i)).toBeInTheDocument()
    expect(screen.getByText(/正在聽寫\.\.\./i)).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1200)
    })

    await act(async () => {
      fireEvent.pointerDown(micButton)
    })

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    const textarea = screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement
    expect(textarea.value).toBeTruthy()
  })
})

describe('Smart Cleanup (semantic mode) — MVP1', () => {
  const selectSemanticMode = () => {
    const modeSelect = screen.getByLabelText('整理模式')
    fireEvent.change(modeSelect, { target: { value: 'semantic' } })
  }

  it('calls /api/smart-cleanup (not /api/cleanup) only after stop, with the final transcript', async () => {
    mockBrowserAudioPipeline()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clean_text: '今晚因性價比關係會食菜心。',
          intent_status: 'decided',
          reasoning_summary: '使用者從生菜改回菜心。',
          confidence: 0.91,
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    selectSemanticMode()

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    // While still recording: interim transcript arrives, must NOT call smart-cleanup yet.
    await act(async () => {
      senseVoiceClientMockState.latestConfig.onTranscription('我今晚想食菜心', false)
      await flushPromises()
    })
    expect(fetchMock).not.toHaveBeenCalledWith('/api/smart-cleanup', expect.anything())

    await act(async () => {
      senseVoiceClientMockState.latestConfig.onTranscription(
        '我今晚想食菜心，都係唔好，都係菜心性價比高啲。',
        true,
      )
      await flushPromises()
    })
    // Final transcript arriving mid-recording must still not trigger smart-cleanup.
    expect(fetchMock).not.toHaveBeenCalledWith('/api/smart-cleanup', expect.anything())

    await act(async () => {
      fireEvent.pointerDown(micButton) // stop
      await flushPromises()
    })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/smart-cleanup', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('都係菜心性價比高啲'),
    }))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/cleanup', expect.anything())

    const lastCallBody = JSON.parse(
      fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body as string,
    )
    expect(lastCallBody.languageMode).toBe('mixed')

    const textarea = screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement
    expect(textarea.value).toBe('今晚因性價比關係會食菜心。')
  })

  it('does not call smart-cleanup when the final transcript is empty', async () => {
    vi.useFakeTimers()
    window.localStorage.setItem('aityping:mic-permission-primed', 'true')
    mockBrowserAudioPipeline()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'test-token', model: 'models/gemini-3.1-flash-live-preview' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    selectSemanticMode()

    // Switch to English so LiveClient (not SenseVoice) is used, matching the
    // existing "no transcript" regression test's setup.
    const languageSelect = screen.getByDisplayValue(/中英混合/i)
    fireEvent.change(languageSelect, { target: { value: 'en' } })

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })

    await act(async () => {
      liveClientMockState.latestClient.emitSetupComplete()
    })

    await act(async () => {
      fireEvent.pointerDown(micButton) // stop, no transcription ever arrived
      await vi.advanceTimersByTimeAsync(4500)
      await flushPromises()
    })

    expect(fetchMock).not.toHaveBeenCalledWith('/api/smart-cleanup', expect.anything())
    expect(screen.getByText(/未收到聽寫文字/i)).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('shows the cleaned semantic result on success', async () => {
    mockBrowserAudioPipeline()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clean_text: '明天會議時間定為十點半，因為需要先送小朋友返學。',
          intent_status: 'decided',
          reasoning_summary: '用戶將十點改為十點半。',
          confidence: 0.88,
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    selectSemanticMode()

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      senseVoiceClientMockState.latestConfig.onTranscription(
        '我聽日想十點開會，唔係，十點半先啱。',
        true,
      )
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton) // stop
      await flushPromises()
    })

    const textarea = screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement
    expect(textarea.value).toBe('明天會議時間定為十點半，因為需要先送小朋友返學。')
    expect(screen.queryByText(/整理失敗/i)).not.toBeInTheDocument()
  })

  it('on smart-cleanup failure, keeps the raw transcript intact and shows a non-blocking error', async () => {
    mockBrowserAudioPipeline()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    selectSemanticMode()

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      senseVoiceClientMockState.latestConfig.onTranscription('原始逐字稿內容', true)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton) // stop
      await flushPromises()
    })

    // Raw transcript must remain visible and unchanged.
    expect(screen.getByText('原始逐字稿內容')).toBeInTheDocument()
    // Non-blocking error shown; cleaned-result textarea stays empty, not crashed.
    expect(screen.getByText(/Smart Cleanup API 呼叫失敗/i)).toBeInTheDocument()
    const textarea = screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })
})

describe('Cleanup mode re-run after recording', () => {
  const completeMessageCleanup = async (fetchMock: ReturnType<typeof vi.fn>) => {
    mockBrowserAudioPipeline()
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    fireEvent.change(screen.getByLabelText('整理模式'), { target: { value: 'message' } })

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton) // prime mic permission
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton) // start SenseVoice recording
      await flushPromises()
    })
    await act(async () => {
      senseVoiceClientMockState.latestConfig.onTranscription('同一份原始逐字稿', true)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton) // stop and cleanup
      await flushPromises()
    })
  }

  it('re-runs /api/cleanup with the same raw transcript when mode changes from message to todo', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cleaned: '訊息整理結果' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cleaned: '待辦整理結果' }) })

    await completeMessageCleanup(fetchMock)

    expect((screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement).value).toBe('訊息整理結果')

    await act(async () => {
      fireEvent.change(screen.getByLabelText('整理模式'), { target: { value: 'todo' } })
      await flushPromises()
    })

    const cleanupCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/cleanup')
    expect(cleanupCalls).toHaveLength(2)
    const rerunBody = JSON.parse(cleanupCalls[1][1].body as string)
    expect(rerunBody).toMatchObject({
      rawTranscript: '同一份原始逐字稿',
      mode: 'todo',
      language: 'mixed',
      style: 'natural',
    })
    expect(screen.getByText('同一份原始逐字稿')).toBeInTheDocument()
    expect((screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement).value).toBe('待辦整理結果')
  })

  it('re-runs /api/smart-cleanup with the same raw transcript when mode changes to semantic', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cleaned: '訊息整理結果' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clean_text: '智能整理結果',
          intent_status: 'decided',
          reasoning_summary: 'same source transcript',
          confidence: 0.9,
        }),
      })

    await completeMessageCleanup(fetchMock)

    await act(async () => {
      fireEvent.change(screen.getByLabelText('整理模式'), { target: { value: 'semantic' } })
      await flushPromises()
    })

    const smartCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/smart-cleanup')
    expect(smartCalls).toHaveLength(1)
    const smartBody = JSON.parse(smartCalls[0][1].body as string)
    expect(smartBody).toMatchObject({
      transcript: '同一份原始逐字稿',
      languageMode: 'mixed',
    })
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/cleanup')).toHaveLength(1)
    expect(screen.getByText('同一份原始逐字稿')).toBeInTheDocument()
    expect((screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement).value).toBe('智能整理結果')
  })

  it('does not call cleanup endpoints when cleanup mode changes while recording', async () => {
    mockBrowserAudioPipeline()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const micButton = screen.getByRole('button', { name: /點一下開始錄音/i })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.pointerDown(micButton)
      await flushPromises()
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('整理模式'), { target: { value: 'todo' } })
      await flushPromises()
    })

    expect(screen.getByText(/RECORDING/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/cleanup', expect.anything())
    expect(fetchMock).not.toHaveBeenCalledWith('/api/smart-cleanup', expect.anything())
  })

  it('does not call cleanup endpoints when cleanup mode changes before any transcript exists', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await act(async () => {
      fireEvent.change(screen.getByLabelText('整理模式'), { target: { value: 'message' } })
      await flushPromises()
    })

    expect(fetchMock).not.toHaveBeenCalledWith('/api/cleanup', expect.anything())
    expect(fetchMock).not.toHaveBeenCalledWith('/api/smart-cleanup', expect.anything())
  })

  it('keeps the raw transcript and old cleaned result visible when re-cleanup fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cleaned: '原本整理結果' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })

    await completeMessageCleanup(fetchMock)

    await act(async () => {
      fireEvent.change(screen.getByLabelText('整理模式'), { target: { value: 'todo' } })
      await flushPromises()
    })

    expect(screen.getByText('同一份原始逐字稿')).toBeInTheDocument()
    expect((screen.getByPlaceholderText(/停止錄音後/i) as HTMLTextAreaElement).value).toBe('原本整理結果')
    expect(screen.getByText(/Cleanup API 呼叫失敗/i)).toBeInTheDocument()
  })
})

describe('柔和生活風 UI — front-page selectors & history placeholder', () => {
  it('defaults the 整理模式 selector to 智能整理 (semantic) on the main screen', () => {
    render(<App />)
    const modeSelect = screen.getByLabelText('整理模式') as HTMLSelectElement
    expect(modeSelect.value).toBe('semantic')
  })

  it('shows both selectors on the main screen without opening settings', () => {
    render(<App />)
    expect(screen.getByLabelText('整理模式')).toBeInTheDocument()
    expect(screen.getByLabelText('語言模式')).toBeInTheDocument()
  })

  it('opens a "歷史紀錄即將推出" placeholder when the history button is tapped, and dismisses it', () => {
    render(<App />)
    expect(screen.queryByText(/歷史紀錄即將推出/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '歷史紀錄' }))
    expect(screen.getByText(/歷史紀錄即將推出/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '好的' }))
    expect(screen.queryByText(/歷史紀錄即將推出/)).not.toBeInTheDocument()
  })
})
