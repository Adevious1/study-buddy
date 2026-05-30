// Emits raw Float32 mono frames (128 samples) at the context sample rate.
// Downsampling + PCM16 conversion happen on the main thread (see audioCapture.ts).
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
