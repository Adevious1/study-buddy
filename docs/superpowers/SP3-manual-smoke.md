# SP3 Manual Smoke Checklist — Live Voice Tutor

> **NOT YET EXECUTED.** This checklist requires a real `GEMINI_API_KEY` and a
> browser with microphone access. It cannot be run in CI. A human must work
> through it locally before declaring SP3 fully verified.

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
