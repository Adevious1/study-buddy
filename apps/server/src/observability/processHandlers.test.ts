import { describe, it, expect } from 'bun:test';
import { makeRejectionHandler, makeExceptionHandler } from './sentry';

describe('process handlers', () => {
  it('rejection handler reports and does NOT exit', () => {
    const reports: unknown[][] = [];
    let exited = false;
    const handler = makeRejectionHandler({
      report: (tag: string, err: unknown) => { reports.push([tag, err]); },
      flush: async () => true,
      exit: () => { exited = true; },
    });
    handler(new Error('async boom'));
    expect(reports).toHaveLength(1);
    expect(reports[0][0]).toBe('unhandled-rejection');
    expect(exited).toBe(false);
  });

  it('exception handler reports, flushes, then exits 1', async () => {
    const calls: string[] = [];
    let exitCode: number | undefined;
    const handler = makeExceptionHandler({
      report: () => { calls.push('report'); },
      flush: async () => { calls.push('flush'); return true; },
      exit: (code: number) => { calls.push('exit'); exitCode = code; },
    });
    handler(new Error('sync boom'));
    await Bun.sleep(10); // let the flush promise settle
    expect(calls).toEqual(['report', 'flush', 'exit']);
    expect(exitCode).toBe(1);
  });
});
