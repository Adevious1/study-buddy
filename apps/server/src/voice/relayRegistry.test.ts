import { describe, it, expect } from 'bun:test';
import { createRelayRegistry } from './relayRegistry';

describe('relayRegistry', () => {
  it('registers, unregisters, and reports size', () => {
    const r = createRelayRegistry();
    const d = { shutdown: async () => {} };
    r.register(d);
    expect(r.size()).toBe(1);
    r.unregister(d);
    expect(r.size()).toBe(0);
  });

  it('drainAll calls shutdown on every registered relay', async () => {
    const r = createRelayRegistry();
    const drained: string[] = [];
    r.register({ shutdown: async () => { drained.push('a'); } });
    r.register({ shutdown: async () => { drained.push('b'); } });
    await r.drainAll(1000);
    expect(drained.sort()).toEqual(['a', 'b']);
  });

  it('drainAll returns within the timeout even if a relay hangs', async () => {
    const r = createRelayRegistry();
    r.register({ shutdown: () => new Promise<void>(() => {}) }); // never resolves
    const start = Date.now();
    await r.drainAll(50);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('tracks draining state', () => {
    const r = createRelayRegistry();
    expect(r.isDraining()).toBe(false);
    r.beginDraining();
    expect(r.isDraining()).toBe(true);
  });
});
