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
        sendAudioStreamEnd: vi.fn(),
        disconnect: vi.fn(),
        waitForCompletion: vi.fn().mockResolvedValue(''),
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

  it('toggles settings menu when sliders button is clicked', async () => {
    render(<App />)

    const settingsButton = screen.getByRole('button', { name: /設定/i })
    expect(settingsButton).toBeInTheDocument()

    expect(screen.queryByText(/整理模式/i)).not.toBeInTheDocument()

    fireEvent.click(settingsButton)
    expect(screen.getByText(/整理模式/i)).toBeInTheDocument()

    fireEvent.click(settingsButton)
    expect(screen.queryByText(/整理模式/i)).not.toBeInTheDocument()
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
