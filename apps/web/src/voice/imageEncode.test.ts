import { describe, it, expect } from 'bun:test';
import { computeTargetSize, captureJpegFromVideo } from './imageEncode';

describe('computeTargetSize', () => {
  it('scales the longest edge down to maxEdge, preserving aspect ratio', () => {
    expect(computeTargetSize(2000, 1000, 1024)).toEqual({ w: 1024, h: 512 });
    expect(computeTargetSize(1000, 2000, 1024)).toEqual({ w: 512, h: 1024 });
  });
  it('leaves images already within maxEdge unchanged', () => {
    expect(computeTargetSize(800, 600, 1024)).toEqual({ w: 800, h: 600 });
  });
});

describe('captureJpegFromVideo', () => {
  it('throws on a not-ready (0x0) video instead of producing a blank image', () => {
    const fakeVideo = { videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement;
    expect(() => captureJpegFromVideo(fakeVideo)).toThrow();
  });
});
