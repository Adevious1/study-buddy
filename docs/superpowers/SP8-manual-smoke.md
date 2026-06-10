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
