# SP8 — Transparent Mid-Session Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a child's voice session run up to ~15 min by transparently reconnecting the relay to Gemini (with the session-resumption handle) across Gemini's ~10-min connection reset, plus a gentle wrap-up nudge before the cap.

**Architecture:** Approach A — in-relay reactive reconnect. The relay's `onClose` handler (today a no-op) re-`connect()`s to Gemini with the stored `resumptionHandle` while the browser↔relay WebSocket stays open. The `'resuming'` state (already in the type system and client UI) is driven by the relay. The soft-cap becomes a 15-min session policy with a ~13-min in-band "director cue" nudge. No schema, no protocol, no shared-types change.

**Tech Stack:** Hono + Bun WebSocket relay, `@google/genai` Live API (`gemini-3.1-flash-live-preview`), `bun test` (DB-backed via a throwaway Postgres), React client (audit-only).

---

## Spec

`docs/superpowers/specs/2026-06-10-study-buddy-reconnect-design.md`

## Prerequisites / how to run tests

Server tests are DB-backed. Per the project's test-DB convention, a throwaway
Postgres must be reachable. From the repo root:

```bash
# one-time: a throwaway PG on 5433 (host 5432 is occupied)
docker run -d --name sb-test-pg -e POSTGRES_USER=studybuddy \
  -e POSTGRES_PASSWORD=studybuddy -e POSTGRES_DB=postgres -p 5433:5432 postgres:16
# drop a stale test DB to force a fresh migrate+seed when schema/seed changed:
docker exec sb-test-pg psql -U studybuddy -d postgres -c 'DROP DATABASE IF EXISTS studybuddy_test;'
```

Run the server suite (and single files) with:

```bash
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test
# single file:
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts
```

`docker` is at `/usr/local/bin` — if `docker` is not found, prefix commands with
`export PATH="/usr/local/bin:$PATH"`.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `apps/server/src/voice/relay.ts` | Session lifecycle + reconnect | Modify: `connectGemini()`, `reconnect()`, `onClose`, nudge, cap=15min |
| `apps/server/src/voice/fakeGeminiSession.ts` | Test double for the Gemini connector | Modify: multi-connect log + `latestEvents()` |
| `apps/server/study-buddy.md` | Tunable Pip prompt (runtime source) | Modify: add director-cue rule |
| `apps/server/src/voice/systemPrompt.ts` | `BUILTIN_TEMPLATE` mirror/fallback | Modify: same rule, byte-identical |
| `apps/server/test/voice/relay.test.ts` | Relay behavior tests | Modify: add reconnect + nudge cases |
| `apps/server/test/voice/systemPrompt.test.ts` | Prompt/drift tests | Modify: assert the cue rule is present |
| `apps/web/src/routes/app/VoiceRoute.tsx` | Voice screen | Audit-only (optional 1-line polish) |
| `docs/superpowers/SP8-manual-smoke.md` | Manual smoke checklist | Create |
| `CLAUDE.md` | Project status | Modify: record SP8 |

---

## Task 1: Extend the fake Gemini connector for multi-connect

The current `makeFakeGemini` resolves a one-time events promise and returns a single
session, so it can't observe a *second* (reconnect) connect. Extend it
**backward-compatibly** (existing relay tests must still pass unchanged).

**Files:**
- Modify: `apps/server/src/voice/fakeGeminiSession.ts`

- [ ] **Step 1: Replace the `FakeHandle` interface and `makeFakeGemini` body**

Replace the entire contents of `apps/server/src/voice/fakeGeminiSession.ts` below the
imports (keep the existing `import type { ... } from './geminiSession';` line) with:

```ts
/** A scripted fake: tests grab the captured events object and push messages in. */
export interface FakeHandle {
  connector: GeminiConnector;
  /** Resolves once the FIRST connect() has wired events (unchanged for existing tests). */
  events(): Promise<GeminiEvents>;
  /** The most recent connect()'s events — use after a reconnect to drive the new session. */
  latestEvents(): GeminiEvents | null;
  /** The most recent connect()'s options. */
  lastOptions(): GeminiConnectOptions | null;
  /** Every connect()'s options, in call order (index 1 is the first reconnect). */
  optionsLog(): GeminiConnectOptions[];
  /** How many times connect() has been called. */
  connectCount(): number;
  sent: { audio: Uint8Array[]; images: string[]; text: string[]; acks: string[]; closed: boolean; audioEnded: boolean };
}

export function makeFakeGemini(): FakeHandle {
  const optsLog: GeminiConnectOptions[] = [];
  const eventsLog: GeminiEvents[] = [];
  let resolveFirst: (e: GeminiEvents) => void;
  const firstEventsP = new Promise<GeminiEvents>((r) => { resolveFirst = r; });
  const sent = { audio: [] as Uint8Array[], images: [] as string[], text: [] as string[], acks: [] as string[], closed: false, audioEnded: false };

  const session: GeminiLiveSession = {
    sendAudio: (pcm) => sent.audio.push(pcm),
    sendImage: (b64) => sent.images.push(b64),
    sendText: (t) => sent.text.push(t),
    ackTool: (_id, name) => sent.acks.push(name),
    audioStreamEnd: () => { sent.audioEnded = true; },
    close: async () => { sent.closed = true; },
  };

  const connector: GeminiConnector = async (o, e) => {
    optsLog.push(o);
    eventsLog.push(e);
    if (eventsLog.length === 1) resolveFirst(e);
    return session;
  };

  return {
    connector,
    events: () => firstEventsP,
    latestEvents: () => eventsLog[eventsLog.length - 1] ?? null,
    lastOptions: () => optsLog[optsLog.length - 1] ?? null,
    optionsLog: () => optsLog,
    connectCount: () => optsLog.length,
    sent,
  };
}
```

- [ ] **Step 2: Run the existing relay tests to confirm backward compatibility**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: PASS — all 10 existing tests still green (the fake's old surface
— `connector`, `events()`, `lastOptions()`, `sent` — is unchanged).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/voice/fakeGeminiSession.ts
git commit -m "test(sp8): extend fake Gemini connector for multi-connect reconnect tests"
```

---

## Task 2: Add the wrap-up director-cue rule to the prompt

Pip must treat a bracketed `[director cue: …]` text message as a private stage
direction, not the child speaking. Add the rule to **both** `study-buddy.md` and the
in-code `BUILTIN_TEMPLATE`, **byte-identical** (the drift guard enforces this).

**Files:**
- Modify: `apps/server/study-buddy.md`
- Modify: `apps/server/src/voice/systemPrompt.ts`
- Test: `apps/server/test/voice/systemPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/server/test/voice/systemPrompt.test.ts`, inside the
`describe('buildSystemInstruction (built-in template, default path)', ...)` block,
add this test after the existing `'substitutes every token…'` test:

```ts
  it('includes the private director-cue rule', async () => {
    const out = await buildSystemInstruction(inputWithTrait);
    expect(out).toContain('director cue');
    expect(out).toContain('not the child speaking');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/systemPrompt.test.ts`
Expected: FAIL — the new test fails (`director cue` not found); the existing
byte-identical drift test still passes (both files unchanged so far).

- [ ] **Step 3: Add the rule to `BUILTIN_TEMPLATE`**

In `apps/server/src/voice/systemPrompt.ts`, in the `BUILTIN_TEMPLATE` literal, insert
this section **immediately before** the `## Learning-signal tool (do not mention to the child)`
line (keep one blank line between sections):

```
## Time check (do not mention to the child)
Sometimes you will receive a bracketed message like "[director cue: ...]". That is a private note from the session, not the child speaking. Do NOT read it aloud or mention it. Quietly follow it — for example, if it says time is almost up, begin guiding {{childName}} toward a natural stopping point and a short recap of what you two figured out together.

```

- [ ] **Step 4: Add the identical rule to `study-buddy.md`**

In `apps/server/study-buddy.md`, insert the **exact same** block (identical text and
spacing) immediately before the `## Learning-signal tool (do not mention to the child)`
line:

```
## Time check (do not mention to the child)
Sometimes you will receive a bracketed message like "[director cue: ...]". That is a private note from the session, not the child speaking. Do NOT read it aloud or mention it. Quietly follow it — for example, if it says time is almost up, begin guiding {{childName}} toward a natural stopping point and a short recap of what you two figured out together.

```

- [ ] **Step 5: Run the test to verify it passes (and the drift guard stays green)**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/systemPrompt.test.ts`
Expected: PASS — the new `director-cue` test passes AND
`'the shipped study-buddy.md is the canonical baseline: byte-identical to BUILTIN_TEMPLATE'`
still passes. If the drift test fails, the two insertions differ — diff them and make
them identical (watch trailing spaces / the blank line).

- [ ] **Step 6: Commit**

```bash
git add apps/server/study-buddy.md apps/server/src/voice/systemPrompt.ts apps/server/test/voice/systemPrompt.test.ts
git commit -m "feat(sp8): teach Pip to follow private bracketed director cues"
```

---

## Task 3: Extract `connectGemini()` + reconnect on Gemini close (happy path)

Wire the `onClose` stub to reconnect with the stored resumption handle.

**Files:**
- Modify: `apps/server/src/voice/relay.ts`
- Test: `apps/server/test/voice/relay.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/server/test/voice/relay.test.ts`, add a `tick` helper just below the `sink()`
function (top-level, before `describe`):

```ts
/** Let the relay's async reconnect (which awaits connectGemini) settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));
```

Then add these two tests inside the `describe('voice relay', ...)` block:

```ts
  it('reconnects with the resumption handle on an unexpected Gemini close', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();

    ev.onResumptionHandle('handle-xyz');
    ev.onClose('reset');
    await tick();

    expect(fake.connectCount()).toBe(2);
    expect(fake.optionsLog()[1].resumptionHandle).toBe('handle-xyz');
    const statuses = out.control.filter((m) => m.type === 'status').map((m) => (m as { state: string }).state);
    expect(statuses).toContain('resuming');
    expect(statuses[statuses.length - 1]).toBe('live');
  });

  it('does not reconnect when Gemini closes after the session has ended', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();
    ev.onResumptionHandle('h');

    await relay.handleControl({ type: 'end' }); // finish(): state -> 'ended', closes session
    ev.onClose('reset');                        // the close finish() triggered
    await tick();

    expect(fake.connectCount()).toBe(1); // never reconnected
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: FAIL — `reconnects with the resumption handle…` fails
(`connectCount` is 1, no reconnect). The `does not reconnect…` test passes already
(today's no-op `onClose` never reconnects) — that's fine, it guards the new behavior.

- [ ] **Step 3: Add constants and the `systemInstruction`/`delay` closure state**

In `apps/server/src/voice/relay.ts`, change the constants near the top (replacing the
existing `SOFT_CAP_MS` line):

```ts
const SOFT_CAP_MS = 15 * 60 * 1000; // hard session cap (wall-clock from start)
const NUDGE_LEAD_MS = 2 * 60 * 1000; // wrap-up nudge fires this long before the cap
const RECONNECT_BACKOFFS_MS = [500, 1500]; // delays between reconnect attempts (2 retries)
const WRAP_UP_CUE =
  '[director cue: about two minutes left — start guiding toward a natural stopping point and a quick recap of what you two figured out.]';
const MAX_SNAPSHOT_BYTES = 2_000_000; // ~2MB decoded; a 1024px q0.85 JPEG is far smaller

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

(Remove the old standalone `const MAX_SNAPSHOT_BYTES = 2_000_000;` line — it is folded
into the block above. Keep its value identical.)

Add `nudgeTimer` and `systemInstruction` to the closure state, next to the existing
`let capTimer` / `let resumptionHandle` declarations:

```ts
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  let systemInstruction = '';
```

Add the new options to the `RelayOptions` interface (after `softCapMs`):

```ts
  softCapMs?: number; // default 15 min
  nudgeLeadMs?: number; // default 2 min before the cap
  reconnectBackoffsMs?: number[]; // default [500, 1500]
```

- [ ] **Step 4: Add `connectGemini()` and `reconnect()`; use them in `start()`; wire `onClose`**

In `events()`, replace the `onClose` line with:

```ts
      onClose: () => { if (state === 'live') void reconnect(); },
```

Add `connectGemini()` and `reconnect()` as functions inside `createRelay` (e.g. just
above `start`):

```ts
  function connectGemini(): Promise<GeminiLiveSession> {
    return connector({ systemInstruction, resumptionHandle }, events());
  }

  async function reconnect() {
    // Only the unexpected mid-session Gemini reset reaches here (onClose checks
    // state === 'live'). Mark 'resuming' so handleAudio drops mic input and the
    // client shows "one sec…".
    state = 'resuming';
    sink.sendControl({ type: 'status', state: 'resuming' });
    if (!resumptionHandle) {
      // No handle yet (sub-~1-min session) — context can't be restored; end cleanly.
      await finish('completed');
      return;
    }
    const backoffs = opts.reconnectBackoffsMs ?? RECONNECT_BACKOFFS_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        const next = await connectGemini();
        // The cap or a child-end may have fired during the await.
        if ((state as State) === 'ended') { try { await next.close(); } catch { /* ignore */ } return; }
        session = next;
        state = 'live';
        sink.sendControl({ type: 'status', state: 'live' });
        return;
      } catch {
        if (attempt >= backoffs.length) break;
        await delay(backoffs[attempt]);
        if ((state as State) === 'ended') return;
      }
    }
    sink.sendControl({ type: 'error', code: 'connection-lost', message: 'Lost connection.' });
    await finish('completed');
  }
```

In `start()`, change the prompt/connect lines (the `const systemInstruction = …` and
`session = await connector(…)` lines) to use the closure var + `connectGemini()`:

```ts
      systemInstruction = await buildPrompt(subjectKind, topic);
      session = await connectGemini();
```

(Do not redeclare `systemInstruction` with `const` — it is now the closure variable.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: PASS — both new tests pass and all existing relay tests stay green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/voice/relay.ts apps/server/test/voice/relay.test.ts
git commit -m "feat(sp8): reconnect to Gemini with the resumption handle on reset"
```

---

## Task 4: Reconnect edge cases — no-handle and retry-exhaustion

**Files:**
- Modify: `apps/server/src/voice/relay.ts` (no new code expected — Task 3 already
  implemented these branches; this task adds their tests)
- Test: `apps/server/test/voice/relay.test.ts`

- [ ] **Step 1: Write the tests**

Add to the `describe('voice relay', ...)` block in `relay.test.ts`:

```ts
  it('ends gracefully (no reconnect) when Gemini closes before any resumption handle', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();

    ev.onClose('reset'); // no handle was ever delivered
    await tick();

    expect(fake.connectCount()).toBe(1); // no reconnect attempted
    expect(out.control.find((m) => m.type === 'status' && (m as { state: string }).state === 'ended')).toBeTruthy();
  });

  it('after exhausting reconnect retries, emits connection-lost and finalizes the session', async () => {
    let calls = 0;
    let captured: import('../../src/voice/geminiSession').GeminiEvents | null = null;
    const session = {
      sendAudio() {}, sendImage() {}, sendText() {}, ackTool() {}, audioStreamEnd() {},
      close: async () => {},
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connector = async (_o: any, e: any) => {
      calls += 1;
      if (calls === 1) { captured = e; return session as any; }
      throw new Error('gemini down'); // every reconnect fails
    };
    const out = sink();
    const relay = createRelay({
      childId: VOICE_TEST_CHILD_ID, connector: connector as never, sink: out,
      reconnectBackoffsMs: [1, 1], // fast retries
    });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    captured!.onResumptionHandle('h');
    captured!.onClose('reset');
    // 3 attempts + 2×1ms backoffs, then finish() does real DB writes before 'ended'.
    await new Promise((r) => setTimeout(r, 200));

    expect(out.control.find((m) => m.type === 'error' && (m as { code: string }).code === 'connection-lost')).toBeTruthy();
    expect(out.control.find((m) => m.type === 'status' && (m as { state: string }).state === 'ended')).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: PASS — both branches were implemented in Task 3; these tests characterize
them. If `after exhausting…` hangs or fails, confirm `reconnectBackoffsMs: [1, 1]`
gives exactly 3 attempts (attempt 0, 1, 2) before the error.

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/voice/relay.test.ts
git commit -m "test(sp8): cover no-handle and retry-exhaustion reconnect paths"
```

---

## Task 5: Transcript continuity across a reconnect

Prove the transcript accumulated **before and after** a reconnect both reach the
recap (the accumulator lives in the relay closure, untouched by the session swap).

**Files:**
- Test: `apps/server/test/voice/relay.test.ts` (no production change)

- [ ] **Step 1: Write the test**

Add to the `describe('voice relay', ...)` block:

```ts
  it('keeps the transcript across a reconnect and includes both halves in the recap', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const recapGen = makeFakeRecapGenerator({
      figuredOut: [], solvedSelf: 0, solvedTotal: 0, starsEarned: 1,
      insightTitle: 't', insightBody: 'b', insightBadge: 'B',
    });
    const relay = createRelay({
      childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out, recapGenerator: recapGen,
    });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });

    const ev1 = await fake.events();
    ev1.onResumptionHandle('h');
    ev1.onOutputTranscript('Before reset', true);
    ev1.onClose('reset');
    await tick();

    const ev2 = fake.latestEvents()!; // the post-reconnect session's events
    ev2.onInputTranscript('After reset', true);

    await relay.handleControl({ type: 'end' });

    expect(recapGen.calls[0].script).toContain('Pip: Before reset');
    expect(recapGen.calls[0].script).toContain('VoiceTester: After reset');
  });
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: PASS — both transcript halves appear in the summarizer script.

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/voice/relay.test.ts
git commit -m "test(sp8): transcript survives a mid-session reconnect"
```

---

## Task 6: 15-min cap + wrap-up nudge

The cap value already changed to 15 min in Task 3. Add the nudge timer that sends the
director cue shortly before the cap.

**Files:**
- Modify: `apps/server/src/voice/relay.ts`
- Test: `apps/server/test/voice/relay.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe('voice relay', ...)` block:

```ts
  it('sends a wrap-up director cue shortly before the cap', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({
      childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out,
      softCapMs: 200, nudgeLeadMs: 150, // nudge at ~50ms, cap at 200ms
    });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    await fake.events();

    await new Promise((r) => setTimeout(r, 100)); // nudge has fired; cap has not
    expect(fake.sent.text.some((t) => t.includes('director cue'))).toBe(true);

    await relay.handleControl({ type: 'end' }); // cancel the pending cap timer
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: FAIL — no text is sent (`fake.sent.text` is empty); the nudge timer
doesn't exist yet.

- [ ] **Step 3: Set up the nudge timer in `start()` and clear it in `finish()`**

In `apps/server/src/voice/relay.ts`, in `start()`, **after** the existing
`capTimer = setTimeout(...); capTimer.unref?.();` lines, add:

```ts
      const cap = opts.softCapMs ?? SOFT_CAP_MS;
      const lead = opts.nudgeLeadMs ?? NUDGE_LEAD_MS;
      nudgeTimer = setTimeout(() => {
        if (state === 'live') {
          try { session?.sendText(WRAP_UP_CUE); } catch { /* best-effort cue */ }
        }
      }, Math.max(0, cap - lead));
      nudgeTimer.unref?.();
```

In `finish()`, where `capTimer` is cleared, also clear `nudgeTimer`:

```ts
    if (capTimer) { clearTimeout(capTimer); capTimer = null; }
    if (nudgeTimer) { clearTimeout(nudgeTimer); nudgeTimer = null; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: PASS — the director cue text is sent once before the cap.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/relay.ts apps/server/test/voice/relay.test.ts
git commit -m "feat(sp8): gentle wrap-up nudge before the 15-min session cap"
```

---

## Task 7: Client audit (and optional polish)

The client already renders `'resuming'` ("one sec…") and navigates to the recap only
on `'ended'` (`VoiceRoute.tsx:150-153`), with `wentLiveRef` surviving a
live→resuming→live cycle. So **no functional change is expected** — this task
confirms that and applies one optional cosmetic improvement.

**Files:**
- Read: `apps/web/src/voice/useVoiceSession.ts`, `apps/web/src/routes/app/VoiceRoute.tsx`
- Modify (optional): `apps/web/src/routes/app/VoiceRoute.tsx`

- [ ] **Step 1: Audit — confirm `'resuming'` is non-terminal and non-destructive**

Verify in the two files:
- `VoiceRoute.tsx` navigation effect fires only when `state.status === 'ended'`
  (it does — line ~150). `'resuming'` does not navigate.
- `useVoiceSession.ts` does not tear down the `AudioPlayer` or mic capture on a
  `'resuming'` status message (it doesn't — teardown happens only on `end()`,
  unmount, or the browser socket closing).
- The browser↔relay socket stays open across a Gemini reconnect (the relay never
  closes it), so `ws.onclose` (which dispatches `status: 'ended'`) does not fire
  during a reconnect.

If any of these is NOT true, stop and fix it (that would be a real bug); otherwise no
change is needed.

- [ ] **Step 2: Optional polish — show Pip "thinking" during a reconnect**

In `VoiceRoute.tsx`, change the `pipState` line so `'resuming'` reads as thinking
rather than idle:

```ts
  const pipState = state.status === 'live' ? 'listen' : (state.status === 'connecting' || state.status === 'resuming') ? 'think' : 'idle';
```

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: PASS (`tsc --noEmit` clean).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/app/VoiceRoute.tsx
git commit -m "polish(sp8): show Pip thinking during a reconnect (audit confirmed no functional change)"
```

(If Step 2 was skipped, commit nothing for this task.)

---

## Task 8: SP8 manual smoke checklist

**Files:**
- Create: `docs/superpowers/SP8-manual-smoke.md`

- [ ] **Step 1: Create the checklist**

Write `docs/superpowers/SP8-manual-smoke.md`:

```markdown
# SP8 (Reconnect / longer sessions) — Manual Smoke Checklist

Needs a real mic + real Gemini (not CI-covered), like SP3/SP6.

## Prerequisites
- Stack up (`docker compose up -d --wait`), `GEMINI_API_KEY` set, signed in, a child selected.
- A quiet ~16 minutes to hold one continuous session (use headphones to avoid echo).

## Flow
1. **Long session survives the reset** — start a voice session and keep talking with
   Pip past ~10 minutes. At Gemini's connection reset, the status pill briefly shows
   **"one sec…"** then returns to **live**; Pip continues **with context** (it
   remembers what you were working on). The browser never reloads.
2. **Multiple resets** — keep going toward ~13 min; a second reset (if it occurs) is
   equally seamless.
3. **Wrap-up nudge (~13 min)** — around two minutes before the cap, Pip begins
   **guiding toward a stopping point / a quick recap** on its own, without the child
   asking and without reading any "[director cue …]" text aloud.
4. **Cap at ~15 min** — the session ends cleanly into the "Putting together what you
   learned…" screen, then `/app/recap` with a real recap covering the whole session.
5. **Reconnect failure (optional)** — if Gemini is unreachable at a reset, the child
   sees a "Lost connection" message and still lands on a recap of the session so far
   (no stuck screen).

## Notes / known limits
- Scope is the **relay↔Gemini** reset only. A drop of the **child's own** network
  (browser↔relay WebSocket) still ends the session as "abandoned" — the seamless
  child-network reconnect is deferred (see the spec's Deferred section).
- Mic audio spoken **during** the brief "one sec…" gap is dropped (not buffered).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/SP8-manual-smoke.md
git commit -m "docs(sp8): manual smoke checklist for reconnect + longer sessions"
```

---

## Task 9: Full verification + status docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full server test suite**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`
Expected: PASS — all suites green (relay reconnect/nudge, prompt drift, plus the
pre-existing recap/auth/billing/pin/etc. tests).

- [ ] **Step 2: Typecheck server + web and build web**

```bash
cd apps/server && bun run build   # tsc --noEmit
cd ../.. && pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build
```
Expected: all clean / build succeeds.

- [ ] **Step 3: Update `CLAUDE.md` status**

In `CLAUDE.md`:
- In the **Status** section, add a short SP8 paragraph: relay↔Gemini transparent
  reconnect via the session-resumption handle across the ~10-min reset; soft-cap
  raised to a 15-min session policy with a ~13-min in-band director-cue wrap-up
  nudge; client `'resuming'` UI driven by the relay; pending its human mic smoke
  (`SP8-manual-smoke.md`). Note that the browser↔relay child-network reconnect and
  GoAway zero-gap reconnect remain deferred.
- In the **Deferred to a later effort** sentence, remove "transparent mid-session
  reconnect across Gemini's ~10-min connection reset" (now delivered) and replace it
  with the remaining seam: the **browser↔relay (child-network) reconnect**.
- In the **Subsystem roadmap**, add item **8. Camera reconnect / longer sessions**
  (or "Reconnect") marked implemented-pending-smoke, mirroring the SP7 entry style.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(sp8): record reconnect subsystem status (pending mic smoke)"
```

---

## Self-review notes (for the implementer)

- **State guard is the only reconnect discriminator** — `finish()` sets
  `state = 'ended'` before `session.close()`, so the `onClose` it triggers is ignored
  by `if (state === 'live')`. Do not add a separate "intentional close" flag.
- **The cap timer is wall-clock from `start()`** — never reset it on reconnect. Only
  `session` is reassigned in `reconnect()`.
- **Byte-identical prompt** — Task 2's two insertions must match exactly or the drift
  guard fails. If it does, `diff` the two files around the new section.
- **Test DB** — every relay test needs `PG_TEST_HOST=localhost PG_TEST_PORT=5433`. A
  bare `bun test` will fail to connect.
