# SP3 Manual Smoke Checklist — Live Voice Tutor

> **VERIFIED (2026-05-31)** via a human mic run against the live Docker stack.
> The full audio loop works end to end — browser ⇄ Hono WS relay ⇄ Gemini Live,
> real speech in and out, live transcript. The behavior fixes below were confirmed
> live, and the previously open End/Back-while-"Connecting…" question is resolved
> (responsive — not a bug). The original Playwright-only "partial" notes are kept
> below for history. Remaining unverified items are the long-tail ones (soft cap,
> mid-session reconnect) called out at the end.

## Live mic run (2026-05-31) — confirmed by a human

Driven by a human in their own Chrome against the live stack (dev seed guardian,
child Maya — who has prior sessions, so the returning-child path). Transcripts are
not persisted, so these were confirmed by the human watching the on-screen
transcript; the server-side session row creation corroborates that the WS + relay
+ Gemini connect succeeded.

| Check | Result |
|---|---|
| WS upgrade + relay + Gemini connect (session row created `in_progress`) | ✅ |
| Real speech in → Pip replies with audio | ✅ |
| Live transcript shows child + Pip turns | ✅ |
| **No re-introduction** each subject (first-session-gated `{{intro}}`) | ✅ greets by name, no "I'm Pip" |
| **No stray `"Text "` prefix** on Pip's bubbles | ✅ gone |
| Discover-and-assess **session flow** (asks what you're learning / what you know / guides with questions) | ✅ followed |
| **End/Back responsive while "Connecting…"** (previously open question) | ✅ responsive — not a bug |

## Partial verification (2026-05-31, via Playwright — no microphone) — superseded by the live run above

Driven against the live Docker stack signed in as the dev seed guardian. The
automated browser has no working mic, so `getUserMedia({audio:true})` **hangs**
(a fake audioinput device is present, but the permission grant never resolves).
The voice connect flow awaits the mic *before* opening the WebSocket, so the
session can't progress past "Connecting…". `GEMINI_API_KEY` IS configured (so the
key is not the blocker — only the mic is).

| Check | Result |
|---|---|
| `GEMINI_API_KEY` present (server container) | ✅ set |
| Voice screen renders (header, Pip, Mute / mic-toggle / End) | ✅ |
| Capture worklet `/pcm-capture-worklet.js` | ✅ 200 (no 404) |
| Voice client modules load (`useVoiceSession`, `audioCapture`, `audioPlayback`, `pcm`, `voiceReducer`) | ✅ 200 |
| Screen reaches "Connecting…" | ✅ |
| Console errors during attempt | ✅ 0 |
| WS upgrade `GET /api/children/:id/voice` | ❌ never sent (client blocked on mic await) — **unverified** |
| Audio in/out, transcript, barge-in, Socratic, profile commit, soft cap | ❌ **unverified** (all mic-dependent) |

> **Open question — RESOLVED in the live run (2026-05-31):** End/Back **are**
> responsive while still "Connecting…". The earlier inertness was an artifact of
> the Playwright mic hang, not a real bug.

## Transcript fixes (2026-05-31) — verify these during the live run

Three transcript/layout bugs were found and fixed after a live session showed the
Pip bubble was unusable. The fixes were verified by unit test + by measuring the
rendered geometry with mock turns (the mic still blocks a real session), but the
**final visual confirmation belongs to the human run** — check each below:

- **Full sentences, not fragments** (`fix(voice): accumulate transcript deltas`).
  Gemini streams transcripts as incremental deltas; the reducer was *replacing*
  the open turn with each delta, so a Pip bubble showed only the last fragment
  ("growing?", "on today?"). Now deltas append into the open turn (a `final` flag
  on each turn ends it). ✅ unit-tested (`apps/web/src/voice/voiceReducer.test.ts`,
  run via `bun test`). **Verify:** Pip's bubbles show complete sentences that grow
  as it speaks.
- **Pip shrinks + transcript fills the screen** (`feat(voice): scrollable
  transcript; Pip shrinks to top`). Before any turns, Pip is large/centered for the
  calm "Listening…" state; once messages start, Pip shrinks (180→96) to the top and
  the transcript takes the freed space. **Verify:** layout reflows once the first
  turn arrives.
- **Transcript scrolls; controls stay pinned** (`fix(voice): cap phone frame to
  viewport height`). The phone frame used `min-h-screen` (a floor that grows past
  the viewport), so a long conversation scrolled the whole page and pushed
  Mute/Mic/End off the bottom. Frame is now `h-[100dvh]`/`h-full` so the transcript
  has a bounded `overflow-y-auto` and auto-scrolls to the newest turn. ✅ verified
  by geometry probe (doc no longer overflows; transcript `scrollH > clientH`; End
  button within the viewport). **Verify:** with a long conversation, the controls
  stay visible at the bottom and the messages scroll internally.

> Driver note: to smoke this layout without a mic, the transcript can be populated
> with mock turns and the rendered geometry measured via Playwright
> (`getBoundingClientRect` / `scrollHeight` vs `clientHeight`). That empirical
> check found the real cause (`min-h-screen`) after several CSS guesses that built
> clean but didn't fix it — measure, don't reason, for layout bugs.

---

## Prerequisites

- [ ] Add `GEMINI_API_KEY=<your-key>` to `.env` at the repo root.
- [ ] Run `docker compose up` from the repo root and wait for all three containers
      (web, server, postgres) to be healthy.
- [ ] Open http://localhost:5173 in Chrome or Firefox (mic permission prompt works
      best in Chrome).

---

## Checklist

### Connection + startup

- [ ] Open a subject from the Subjects screen → Voice screen shows connecting state
      briefly, then transitions to live.
- [ ] Mic-permission prompt appears; grant it.
- [ ] WebSocket upgrade succeeds at `GET /api/children/:childId/voice`; no errors
      in the server log.
- [ ] The capture worklet loads from `/pcm-capture-worklet.js` with no 404 in the
      browser network tab.

### Audio in / out

- [ ] Speak a question → Pip replies WITH AUDIO (not silent); the output
      `AudioContext` resumes on the first playback chunk (no silent first packet).
- [ ] The live transcript shows both child turns and Pip turns updating in real
      time.

### Barge-in / interruption

- [ ] While Pip is speaking, speak again → Pip's playback stops promptly
      (barge-in clear); Pip listens and then responds to the new input.

### Socratic behavior

- [ ] Ask Pip a direct homework question (e.g. "What is 8 × 7?") → Pip guides
      with a Socratic hint, not a direct answer.

### Subject chooser (free-talk path)

- [ ] Tap "Just talk with Pip" (or equivalent entry point) → 4-option subject
      chooser appears.
- [ ] Pick a subject → session starts with the correct subject shown in the voice
      screen header.

### Error handling

- [ ] Deny mic permission → `ErrorState` shows "Pip needs your microphone" (or
      equivalent copy); no unhandled exception in the console.

### Navigation / session end

- [ ] Tap End → returns to Home (`/app`); no leftover audio context warnings in
      console.
- [ ] Tap the Back button (browser or in-app) from the voice screen → also returns
      to `/app` cleanly.

### Profile commit

- [ ] Open the Profile screen ("How I learn") after a completed session → trait
      scores and/or profile note reflect activity from the session (profile commit
      runs on session end).

### Soft cap

- [ ] Leave the session idle for approximately 10 minutes (or temporarily lower
      `softCapMs` in `apps/server/src/voice/relay.ts` to a short value, e.g.
      30 000 ms) → Pip wraps up the session gracefully and the session ends
      automatically.

---

## Known not-yet-implemented

- [ ] **Mid-session network blip recovery (seamless reconnect)** — if the
      connection drops mid-session (e.g. a network blip or Gemini's ~10-min
      connection reset), the current behavior is session end / abandon rather than
      seamless resume. This is the remaining seam deferred from SP3. For now,
      expect the session to end; do NOT mark this item as passing.
