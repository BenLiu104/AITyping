// resample.ts - Resample helper to convert float32 array samples to 16kHz
export function resampleTo16k(inputBuffer: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) {
    return inputBuffer;
  }
  
  const sampleRateRatio = inputSampleRate / 16000;
  const newLength = Math.round(inputBuffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  
  for (let i = 0; i < newLength; i++) {
    const nearestIndex = Math.round(i * sampleRateRatio);
    // Boundary safe mapping
    result[i] = inputBuffer[Math.min(nearestIndex, inputBuffer.length - 1)];
  }
  
  return result;
}

// floatTo16BitPCM.ts - Converts Float32 PCM arrays into little-endian Int16 raw PCM binary ArrayBuffers
export function floatTo16BitPCM(f32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(f32Array.length * 2);
  const view = new DataView(buffer);
  
  for (let i = 0; i < f32Array.length; i++) {
    // Clamp to sound pressure amplitude boundaries [-1.0, 1.0]
    const s = Math.max(-1, Math.min(1, f32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); // true for little-endian
  }
  
  return buffer;
}
