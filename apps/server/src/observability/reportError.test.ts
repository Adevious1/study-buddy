import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { reportError, reportSignal, __setSentryForTests, __resetSentryForTests } from './reportError';

type Captured = { kind: 'exception' | 'message'; value: unknown; ctx: Record<string, unknown> };
let captured: Captured[] = [];
let logged: string[] = [];
const origError = console.error;
const origWarn = console.warn;

beforeEach(() => {
  captured = [];
  logged = [];
  console.error = (line: unknown) => { logged.push(String(line)); };
  console.warn = (line: unknown) => { logged.push(String(line)); };
  __setSentryForTests({
    captureException: (value, ctx) => { captured.push({ kind: 'exception', value, ctx: ctx as Record<string, unknown> }); },
    captureMessage: (value, ctx) => { captured.push({ kind: 'message', value, ctx: ctx as Record<string, unknown> }); },
  });
});

afterEach(() => {
  console.error = origError;
  console.warn = origWarn;
  __resetSentryForTests();
});

describe('reportError', () => {
  it('emits a structured log line and captures the exception with tag + context', () => {
    const err = new Error('boom');
    reportError('snapshot-save', err, { sessionId: 's-1', childId: 'c-1' });

    expect(logged).toHaveLength(1);
    const line = JSON.parse(logged[0]);
    expect(line.level).toBe('error');
    expect(line.msg).toBe('snapshot-save');
    expect(line.error).toBe('boom');
    expect(line.sessionId).toBe('s-1');
    expect(typeof line.ts).toBe('string');

    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe('exception');
    expect(captured[0].value).toBe(err);
    const ctx = captured[0].ctx as { level: string; tags: Record<string, string>; extra: Record<string, unknown> };
    expect(ctx.level).toBe('error');
    expect(ctx.tags.tag).toBe('snapshot-save');
    expect(ctx.extra.sessionId).toBe('s-1');
  });

  it('supports warning level', () => {
    reportError('seat-sync', new Error('x'), {}, 'warning');
    expect(JSON.parse(logged[0]).level).toBe('warning');
    expect((captured[0].ctx as { level: string }).level).toBe('warning');
  });
});

describe('reportSignal', () => {
  it('logs and captures a message with default warning level', () => {
    reportSignal('recap-fallback', { reason: 'timeout', turns: 12 });
    const line = JSON.parse(logged[0]);
    expect(line.msg).toBe('recap-fallback');
    expect(line.reason).toBe('timeout');
    expect(captured[0].kind).toBe('message');
    expect(captured[0].value).toBe('recap-fallback');
    const ctx = captured[0].ctx as { level: string; tags: Record<string, string> };
    expect(ctx.level).toBe('warning');
    expect(ctx.tags.tag).toBe('recap-fallback');
  });
});
