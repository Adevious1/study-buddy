import { pcm16ToFloat } from './pcm';

const OUTPUT_RATE = 24000;

/** Gapless queue player for 24 kHz PCM16 chunks, with clear-on-interrupt. */
export class AudioPlayer {
  private ctx: AudioContext;
  private nextStartTime = 0;
  private active: AudioBufferSourceNode[] = [];

  constructor() {
    this.ctx = new AudioContext({ sampleRate: OUTPUT_RATE });
  }

  enqueue(pcm16Bytes: Uint8Array): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    // Bytes → Int16 (little-endian) → Float32
    const int16 = new Int16Array(
      pcm16Bytes.buffer as ArrayBuffer,
      pcm16Bytes.byteOffset,
      Math.floor(pcm16Bytes.byteLength / 2),
    );
    const floats = pcm16ToFloat(int16) as Float32Array<ArrayBuffer>;
    const buffer = this.ctx.createBuffer(1, floats.length, OUTPUT_RATE);
    buffer.copyToChannel(floats, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    const start = Math.max(now, this.nextStartTime);
    src.start(start);
    this.nextStartTime = start + buffer.duration;
    this.active.push(src);
    src.onended = () => { this.active = this.active.filter((s) => s !== src); };
  }

  /** Stop everything immediately (child barged in). */
  clear(): void {
    for (const s of this.active) { try { s.stop(); } catch { /* ignore */ } }
    this.active = [];
    this.nextStartTime = this.ctx.currentTime;
  }

  close(): void {
    this.clear();
    void this.ctx.close();
  }
}
