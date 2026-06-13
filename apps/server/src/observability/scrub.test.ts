import { describe, it, expect } from 'bun:test';
import { scrubEvent, scrubContext } from './scrub';

describe('scrubContext', () => {
  it('keeps allowlisted keys and drops everything else', () => {
    const out = scrubContext({
      childId: 'c-1', sessionId: 's-1', guardianId: 'g-1',
      transcript: [{ role: 'child', text: 'my name is Maya' }],
      childName: 'Maya', email: 'parent@x.com',
      durationMs: 1234, reason: 'timeout',
    });
    expect(out).toEqual({ childId: 'c-1', sessionId: 's-1', guardianId: 'g-1', durationMs: 1234, reason: 'timeout' });
  });

  it('returns an empty object for undefined input', () => {
    expect(scrubContext(undefined)).toEqual({});
  });
});

describe('scrubEvent', () => {
  it('drops request body, cookies, and headers', () => {
    const event = scrubEvent({
      request: {
        url: 'http://x/api/me/children',
        method: 'POST',
        data: { name: 'Maya', birthDate: '2017-01-01' },
        cookies: { 'better-auth.session_token': 'secret' },
        headers: { cookie: 'secret', authorization: 'Bearer x' },
      },
    });
    expect(event.request).toEqual({ url: 'http://x/api/me/children', method: 'POST' });
  });

  it('reduces user to id only', () => {
    const event = scrubEvent({ user: { id: 'g-1', email: 'parent@x.com', username: 'Jude', ip_address: '1.2.3.4' } });
    expect(event.user).toEqual({ id: 'g-1' });
  });

  it('filters extra and tags through the allowlist', () => {
    const event = scrubEvent({
      extra: { childId: 'c-1', transcript: 'secret words' },
      tags: { tag: 'snapshot-save', childName: 'Maya' },
    });
    expect(event.extra).toEqual({ childId: 'c-1' });
    expect(event.tags).toEqual({ tag: 'snapshot-save' });
  });

  it('passes through an event with none of the scrubbable fields', () => {
    const event = scrubEvent({ message: 'boom' });
    expect(event.message).toBe('boom');
  });
});
