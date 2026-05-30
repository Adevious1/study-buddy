import { downsampleTo16k, floatToPcm16 } from './pcm';

export interface Capture {
  stop: () => void;
}

/** Request the mic, stream 16 kHz PCM16 frames to `onFrame`. Throws on denial. */
export async function startCapture(onFrame: (pcm16: Int16Array) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('/pcm-capture-worklet.js');
  if (ctx.state === 'suspended') await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-capture');
  // Muted sink: keeps the worklet pulled (processing) in browsers that require a
  // path to the destination, WITHOUT playing the raw mic back to the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const down = downsampleTo16k(e.data, ctx.sampleRate);
    onFrame(floatToPcm16(down));
  };
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);
  return {
    stop: () => {
      node.port.onmessage = null;
      node.disconnect();
      mute.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
