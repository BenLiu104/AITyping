import { describe, it, expect } from 'vitest'
import { resampleTo16k, floatTo16BitPCM } from './converter'

describe('Audio Converter Pipeline Helpers', () => {
  describe('resampleTo16k', () => {
    it('returns unmodified buffer if source is already 16kHz', () => {
      const input = new Float32Array([0.1, 0.2, 0.3])
      const output = resampleTo16k(input, 16000)
      expect(output).toBe(input)
    })

    it('downsamples 48kHz audio to 16kHz correctly', () => {
      // 48kHz is 3x the density of 16kHz
      const input = new Float32Array([0.0, 0.5, 1.0, 0.9, 0.4, 0.1, -0.5, -1.0, -0.2]) // length 9
      const output = resampleTo16k(input, 48000)
      
      // Expected length should be exactly 9 / 3 = 3
      expect(output.length).toBe(3)
      
      // Maps indexes [0, 3, 6] to input index mappings approximately
      expect(output[0]).toBeCloseTo(0.0, 3)
      expect(output[1]).toBeCloseTo(0.9, 3)
      expect(output[2]).toBeCloseTo(-0.5, 3)
    })
  })

  describe('floatTo16BitPCM', () => {
    it('converts floating points down into correct Little Endian Int16 binary', () => {
      const input = new Float32Array([0.0, 0.5, -1.0, 1.0])
      const pcmBuffer = floatTo16BitPCM(input)
      
      expect(pcmBuffer.byteLength).toBe(8) // 4 samples * 2 bytes each
      
      const view = new DataView(pcmBuffer)
      // index 0 -> 0.0 -> 0
      expect(view.getInt16(0, true)).toBe(0)
      // index 1 -> 0.5 -> 0.5 * 32767 = 16383
      expect(view.getInt16(2, true)).toBeCloseTo(16383, 1)
      // index 2 -> -1.0 -> -32768
      expect(view.getInt16(4, true)).toBe(-32768)
      // index 3 -> 1.0 -> 32767
      expect(view.getInt16(6, true)).toBe(32767)
    })
  })
})
