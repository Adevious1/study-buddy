import { describe, it, expect } from 'bun:test';
import { InMemoryEphemeralStore } from './ephemeralStore';

describe('InMemoryEphemeralStore', () => {
  it('increments within a window and reports count + resetAt', () => {
    const s = new InMemoryEphemeralStore();
    const a = s.increment('k', 1000, 0);
    expect(a).toEqual({ count: 1, resetAt: 1000 });
    const b = s.increment('k', 1000, 200);
    expect(b).toEqual({ count: 2, resetAt: 1000 }); // same window, resetAt unchanged
  });

  it('starts a fresh window once the old one expires', () => {
    const s = new InMemoryEphemeralStore();
    s.increment('k', 1000, 0);
    const c = s.increment('k', 1000, 1000); // at expiry boundary → new window
    expect(c).toEqual({ count: 1, resetAt: 2000 });
  });

  it('get returns the value until expiry, then null', () => {
    const s = new InMemoryEphemeralStore();
    s.set('lock', 5000, 1000, 0);
    expect(s.get('lock', 500)).toBe(5000);
    expect(s.get('lock', 1000)).toBeNull(); // expiresAt = now+ttl = 1000; now=1000 → expired
  });

  it('delete removes a key', () => {
    const s = new InMemoryEphemeralStore();
    s.set('k', 1, 1000, 0);
    s.delete('k');
    expect(s.get('k', 0)).toBeNull();
  });

  it('get on a missing key is null', () => {
    const s = new InMemoryEphemeralStore();
    expect(s.get('nope', 0)).toBeNull();
  });
});
