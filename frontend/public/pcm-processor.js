// pcm-processor.js
// AudioWorkletProcessor defined on PWA client to gather audio buffer blocks from microphone input

class PCMProcessor extends AudioWorkletProcessor {
  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (input && input[0]) {
      const channelData = input[0]; // Gather mono channel (usually first channel)
      
      // Clone channelData to prevent reference side effects inside postMessage asynchronously
      const buffer = new Float32Array(channelData.length);
      buffer.set(channelData);
      
      this.port.postMessage(buffer);
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
