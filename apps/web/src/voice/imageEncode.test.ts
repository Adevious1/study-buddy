import { describe, it, expect } from 'bun:test';
import { computeTargetSize } from './imageEncode';

describe('computeTargetSize', () => {
  it('scales the longest edge down to maxEdge, preserving aspect ratio', () => {
    expect(computeTargetSize(2000, 1000, 1024)).toEqual({ w: 1024, h: 512 });
    expect(computeTargetSize(1000, 2000, 1024)).toEqual({ w: 512, h: 1024 });
  });
  it('leaves images already within maxEdge unchanged', () => {
    expect(computeTargetSize(800, 600, 1024)).toEqual({ w: 800, h: 600 });
  });
});
