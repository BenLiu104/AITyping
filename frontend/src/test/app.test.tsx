import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import App from '../App'

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

describe('App Component Core UI Tests', () => {
  it('renders app title correctly', () => {
    render(<App />)
    expect(screen.getByText('AITyping')).toBeInTheDocument()
  })

  it('toggles settings menu when sliders button is clicked', async () => {
    render(<App />)
    
    // Sliders button should be available
    const settingsButton = screen.getByRole('button', { name: /設定/i })
    expect(settingsButton).toBeInTheDocument()

    // Initially settings shouldn't be visible (no option elements)
    expect(screen.queryByText(/整理模式/i)).not.toBeInTheDocument()

    // Click to open settings
    fireEvent.click(settingsButton)
    expect(screen.getByText(/整理模式/i)).toBeInTheDocument()

    // Click again to close
    fireEvent.click(settingsButton)
    expect(screen.queryByText(/整理模式/i)).not.toBeInTheDocument()
  })

  it('runs mock recording pipeline on mic button push and release', async () => {
    vi.useFakeTimers()
    render(<App />)

    const micButton = screen.getByRole('button', { name: /按住說話/i })
    expect(micButton).toBeInTheDocument()

    // Touch start to trigger recording
    await act(async () => {
      fireEvent.mouseDown(micButton)
    })

    expect(screen.getByText(/RECORDING/i)).toBeInTheDocument()
    expect(screen.getByText(/正在聽寫\.\.\./i)).toBeInTheDocument()

    // Advance time to simulate speech
    await act(async () => {
      vi.advanceTimersByTime(1200)
    })

    // Touch end to stop recording and trigger simulation cleanup
    await act(async () => {
      fireEvent.mouseUp(micButton)
    })

    // Advance mock API cleanup delay
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    // Should have cleaned result text in textarea now
    const textarea = screen.getByPlaceholderText(/放開 Mic 按鈕後/i) as HTMLTextAreaElement
    expect(textarea.value).toBeTruthy()

    vi.useRealTimers()
  })
})
