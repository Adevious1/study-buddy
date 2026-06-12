# SP8 (Reconnect / longer sessions) — Manual Smoke Checklist

> **✅ RUN 2026-06-12 (iPhone Chrome via cloudflared tunnel + human mic):** one
> continuous **14.1-minute session, 114 transcript turns**, state `completed`,
> full recap generated.
> - **Reset survived (~10 min):** runner saw the brief **"one sec…"** pill flip
>   back to live; Pip continued **with context**; no reload. Transcript runs
>   unbroken across the reset.
> - **Wrap-up nudge (~13 min):** Pip steered toward a stopping point on its own
>   and never read the "[director cue …]" text aloud.
> - **End → recap:** runner tapped End at 14.1 min after the wrap-up; clean
>   "Putting together…" → `/app/recap` with a session-specific recap.
> - **Partially verified:** the 15-min **auto-cap firing on its own** was not
>   observed (manual End preceded it); the cap timer is unit-covered in
>   `test/voice/relay.test.ts`. Step 5 (reconnect-failure fallback) was not
>   exercised (no Gemini outage; also unit-covered).
> - Side finding (not SP8): a ~13-second tap-in/out session with **0 transcript
>   turns** still produced a generated recap claiming invented achievements —
>   the summarizer should fall back to the modest default below a minimum
>   transcript length. Logged in the audit doc.

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
