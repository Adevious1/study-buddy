# SP8 — Transparent Mid-Session Reconnect ("longer sessions")

**Status:** Design (approved 2026-06-10), pending implementation plan.
**Depends on:** SP3 (live voice tutor), SP6 (session recap). No schema change.

## Goal

Let a child have a **longer continuous voice session with Pip** (up to ~15 min,
versus today's effective ~10 min) without the session dying when Gemini's single
WebSocket connection hits its ~10-minute server-side reset. The reconnect is
**invisible** apart from a brief "one sec…" pause; Pip resumes with full
conversational context. The existing soft-cap is repurposed from a *reset
workaround* into a real **"time to wrap up" policy**.

## Background: why this is a seam, not a greenfield feature

SP3 left this deliberately pre-shaped. Already in the codebase:

- **Gemini session resumption is plumbed** — `apps/server/src/voice/geminiSession.ts`
  passes `sessionResumption: { handle }` on connect and captures
  `sessionResumptionUpdate.newHandle` via `onResumptionHandle`. The relay stores it
  in `resumptionHandle` (`relay.ts:43`, `:101`).
- **The relay state machine already has `'resuming'`** (`relay.ts:27`).
- **The client is already reconnect-aware** — `VoiceStatus` includes `'resuming'`
  and `VoiceRoute.tsx` renders "one sec…" / "One sec…" for it (`:237`, `:259`).
- **The trigger is an explicit stub** — `onClose: () => { /* expected ~10min reset;
  transport reconnect handled in a later task */ }` (`relay.ts:102`).
- **Mic audio is already gated on `state === 'live'`** (`relay.ts:206`), so audio is
  dropped automatically during a `'resuming'` gap with no extra work.

Today the soft-cap (`SOFT_CAP_MS = 10 min`, `relay.ts:128-130`) fires
`finish('completed')` right around when Gemini would reset, which *sidesteps*
reconnect by simply ending the session. This effort wires the stub and lifts the
cap to a real policy value.

## Verified Gemini Live facts (current docs, 2026-06-10)

Confirmed against the Gemini Live API skill / live docs (per the project rule to
verify model facts, not infer them):

- **Single connection lifetime: ~10 min** — the reset we reconnect across.
- **Audio-only session limit: 15 min _without_ compression.** Going beyond 15 min
  requires context-window compression (a sliding window that compresses/drops the
  oldest context). **We cap at ~15 min and do NOT enable compression** — full
  conversation context is retained for the whole session.
- **Session resumption** is the supported mechanism for surviving the connection
  reset; the handle restores server-side session state (context) on a fresh
  connection. Model: `gemini-3.1-flash-live-preview`, 128k-token context window.
- **GoAway** advance-warning signals exist but are **not used** — we chose a reactive
  reconnect (brief pause acceptable), so we react to `onClose` rather than
  pre-empting on GoAway.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Primary goal | Longer continuous sessions, reconnect invisible; soft-cap → wrap-up policy |
| Max session length | **~15 min** hard cap, wall-clock from session start |
| Context compression | **No** — stay within Gemini's 15-min uncompressed audio limit |
| Reconnect scope | **Relay↔Gemini only.** Browser↔relay (child-network) reconnect is **deferred** |
| Reconnect feel | **Reactive**, brief "one sec…" pause; mic audio during the gap is **dropped** (not buffered) |
| Behavior at cap | **Gentle wrap-up nudge** ~2 min before, then `finish('completed')` at the hard cap |
| Structuring approach | **A — in-relay reactive reconnect** (smallest change, fits the scaffolding) |
| Reconnect failure | Bounded retries, then resolve as **`completed`** (child still gets a recap) |

## Design

### 1. State machine & reconnect trigger

Reuse the existing `State` (`'idle' | 'connecting' | 'live' | 'resuming' | 'ended'`).
Transitions added/used:

- `live → resuming` — Gemini `onClose` fires while `state === 'live'` (the
  unexpected reset).
- `resuming → live` — a reconnect attempt succeeds.
- `resuming → ended` — reconnect retries exhausted, or the cap / child-end fires
  during the gap.

**Discriminating an expected close from the reset needs no new flag — the state is
the flag.** `finish()` already sets `state = 'ended'` *before* `session.close()`
(`relay.ts:139-141`), so the `onClose` it triggers is ignored. The new handler is:

```
onClose: () => { if (state !== 'live') return; void reconnect(); }
```

A close seen during `connecting`, `resuming`, or `ended` never triggers a
(re)connect.

### 2. `connectGemini()` extraction + `reconnect()`

Extract the Gemini-connect block currently inline in `start()` into a private
`connectGemini(): Promise<GeminiLiveSession>` that reads the relay's **current**
`resumptionHandle` and `systemInstruction`. `start()` calls it for the first
connection (handle `undefined`); `reconnect()` calls it with the latest handle.

`reconnect()` algorithm:

1. `state = 'resuming'`; `sink.sendControl({ type: 'status', state: 'resuming' })`.
   (Mic audio auto-drops via the `state === 'live'` guard; Pip's playback simply
   pauses client-side.)
2. If `resumptionHandle === undefined` (rare — a sub-~1-min session that never
   received a handle): resumption is impossible → `await finish('completed')` and
   return. (No fresh-context reconnect — that would silently lose the conversation.)
3. Otherwise attempt `session = await connectGemini()`:
   - **Success:** `state = 'live'`; `sink.sendControl({ type: 'status', state: 'live' })`.
   - **Failure:** await a short backoff and retry, up to **2 retries** (3 attempts
     total). Backoff e.g. 500 ms, then 1500 ms.
4. All attempts fail → `sink.sendControl({ type: 'error', code: 'connection-lost',
   message: 'Lost connection.' })` then `await finish('completed')`.

`TranscriptAccumulator`, `SignalAccumulator`, `capTimer`, and the new `nudgeTimer`
live in the relay closure and are **never reset on reconnect** — only `session` is
reassigned. `events()` is regenerated per connect (it already is in `start()`); its
`session?.ackTool` closure resolves to the latest `session`.

**Re-entrancy:** a reconnect is only ever started from `onClose` while `state ===
'live'`. Once `reconnect()` sets `state = 'resuming'`, a stray second `onClose`
(from the already-closed old session) is ignored by the `state !== 'live'` guard, so
there is no double reconnect.

### 3. Cap → 15 min + gentle wrap-up nudge

- `SOFT_CAP_MS` → **15 min** (`opts.softCapMs` override retained for tests). The cap
  timer is set once in `start()` and is wall-clock from session start; it **survives
  reconnects** (15 min total, not per connection). Mechanism unchanged — only the
  value changes. At the cap, the existing `finish('completed')` path runs (recap →
  wrapping-up screen → `/app/recap`).
- New **`nudgeTimer`**, set once in `start()` at `cap − ~2 min` (~13 min). When it
  fires (and `state === 'live'`), the relay sends an in-band **director cue** to
  Gemini via the existing `session.sendText(...)`
  (`sendRealtimeInput({ text })` under the hood — the correct API for runtime text):

  > `[director cue: about two minutes left — start guiding toward a natural
  > stopping point and a quick recap of what you two figured out.]`

  If the timer fires while `state === 'resuming'`, defer/skip (best-effort; the cue
  is a nicety, not load-bearing). Like the cap timer it is `unref()`'d.

- **Prompt change:** add one short rule to **`apps/server/study-buddy.md`** telling
  Pip that a bracketed `[director cue: …]` message is a private stage direction (not
  the child speaking) to follow quietly. Keep the in-code `BUILTIN_TEMPLATE`
  **byte-identical** (the existing drift-guard test must continue to pass).

### 4. Client (minimal)

The browser↔relay WebSocket stays open the entire time; the client only observes
status flips `live → resuming → live`. The `status` reducer case already handles
this; no new client messages or reducer cases.

Audit-only changes in `useVoiceSession.ts` / `VoiceRoute.tsx`:
- Confirm a `'resuming'` status does **not** trigger teardown, an error, or any
  "ended"/recap-navigation path.
- Confirm the `AudioPlayer` and mic capture are **not** torn down on `'resuming'`
  (Pip's audio just pauses; the mic indicator shows "One sec…"). The capture
  callback already no-ops sends when the socket is open and mic active; nothing to
  change unless the audit finds a gap.

### 5. Error & edge handling summary

| Situation | Handling |
|---|---|
| Gemini `onClose` while `live` | `reconnect()` with the stored handle |
| `onClose` during `finish()` teardown (`ended`) | Ignored (`state !== 'live'`) |
| `onClose` with no handle yet | `finish('completed')`, no reconnect attempt |
| Reconnect attempt throws | Backoff + retry ×2 |
| Retries exhausted | `error: connection-lost` → `finish('completed')` |
| Cap fires during a `resuming` gap | `finish('completed')` runs; close is ignored |
| Child taps End during a gap | `finish('completed')` runs as normal |
| Browser WS drops during a gap | `handleDisconnect()` → `finish('abandoned')` (today's behavior; in scope only for the deferred child-network work) |

## Testing

Server-heavy and unit-testable via the injectable fake in
`apps/server/src/voice/fakeGeminiSession.ts` (`makeFakeGemini`). **There are no relay
tests today** — the fake is already built but currently unused by any test, so this
effort introduces `apps/server/src/voice/relay.test.ts` as the first relay coverage.
The fake must be **extended** to support reconnect: today its `connector` resolves a
one-time events promise and returns a single shared session. It needs to (a) accept
**multiple** `connect` calls, wiring fresh `events` and recording each call's
`resumptionHandle`, and (b) let a test trigger `onClose` on demand.

Relay tests (new `relay.test.ts`):
1. Unexpected `onClose` while live → emits `status: resuming` then `status: live`;
   the **2nd** connect carried the latest `resumptionHandle`.
2. Transcript accumulated before **and** after a reconnect is intact in the
   finalized recap.
3. Reconnect failure × (retries + 1) → emits `error: connection-lost` and
   `finalizeLiveSession(..., 'completed')`.
4. `onClose` after `finish()` (state `ended`) → **no** reconnect (no 2nd connect).
5. `onClose` with no handle → `finish('completed')`, no reconnect.
6. Nudge: with a short test cap, the `nudgeTimer` sends the director-cue text
   exactly once while live.
7. Prompt drift-guard: `study-buddy.md` ⇄ `BUILTIN_TEMPLATE` byte-identical
   (existing test, must stay green after the rule is added).

**Manual smoke** (`docs/superpowers/SP8-manual-smoke.md`, like SP3/SP6): a human mic
run confirming a >10-min session survives the real Gemini reset (brief "one sec…",
Pip resumes with context), the ~13-min wrap-up nudge lands, and the 15-min cap ends
cleanly into `/app/recap`. Not CI-covered (needs a mic + real Gemini).

## Files touched

- `apps/server/src/voice/relay.ts` — `connectGemini()` extraction, `reconnect()`,
  `onClose` handler, `nudgeTimer`, `SOFT_CAP_MS` → 15 min.
- `apps/server/src/voice/fakeGeminiSession.ts` — extend for multiple connects +
  on-demand `onClose` trigger + per-connect handle capture.
- `apps/server/study-buddy.md` + the `BUILTIN_TEMPLATE` in
  `apps/server/src/voice/systemPrompt.ts` — the director-cue rule (byte-identical).
- `apps/server/src/voice/relay.test.ts` — **new file** (first relay test coverage)
  with the cases above.
- `apps/web/src/voice/useVoiceSession.ts` / `routes/app/VoiceRoute.tsx` —
  audit-only, change only if the audit finds a `'resuming'` gap.
- `docs/superpowers/SP8-manual-smoke.md` — new manual smoke checklist.

## Deferred (out of scope)

- **Browser↔relay (child-network) reconnect** — surviving the child's own WebSocket
  dropping (wifi blip, tab sleep) needs relay session persistence + browser
  re-attach + a grace window, and is a meaningfully larger effort. Tabled as a
  post-production-deploy feature. The Approach-C "durable session" wrapper would be
  the natural home for it if/when built.
- **GoAway-based proactive / zero-gap reconnect** — a later polish if the brief
  "one sec…" pause ever feels rough.
- **Context-window compression / >15-min sessions** — not needed at the 15-min cap.

## Non-goals

- No change to auth, billing, recap content, snapshots, or the DB schema.
- No change to the browser↔relay protocol message set (only existing `status` /
  `error` control messages are used).
