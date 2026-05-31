# Study Buddy — Session Recap (SP6) Design

**Date:** 2026-05-31
**Status:** Design approved; spec under review.
**Depends on:** SP3 (live voice tutor). Builds on the existing — but unwired —
recap UI/schema/contract shipped in SP1/SP2.

## 1. Problem & context

A voice tutoring session today ends silently: `relay.finish()` finalizes the
session row, commits learning-profile trait deltas, and the client navigates the
child back to Home (`/app`). Nothing summarizes what just happened.

Meanwhile, a full **recap experience already exists but has no data source**:

- **UI** — `apps/web/src/routes/app/RecapRoute.tsx` is fully designed: celebration
  header, stars, a "Solved it yourself" count, a "What we figured out" checklist,
  and a "Pip noticed…" insight card, plus a graceful "No recap yet" empty state.
- **Schema** — the `sessions` table already has every recap column
  (`starsEarned`, `starsMax`, `solvedSelf`, `solvedTotal`, `figuredOut` jsonb,
  `insightTitle`, `insightBody`, `insightBadge`) — all currently **NULL**.
- **Contract** — `GET /api/children/:childId/sessions/latest/recap`
  (`apps/server/src/routes/sessions.ts`) already returns a `RecapResult`,
  defaulting every field to `0`/`[]`/`''`. `Repository.getRecap()` is wired.

So the screen renders — just empty. This feature supplies the **missing data
source and the routing** to reach it, and persists the transcript as a byproduct.

## 2. Goals / non-goals

**Goals**
- Generate a warm, child-facing recap from each **completed** session.
- Persist the session transcript (clears the separately-tracked "transcript
  persistence" deferral).
- Route the child from session-end to the populated recap screen.
- Keep the live voice loop (browser ⇄ Hono WS ⇄ Gemini Live) untouched.
- Never show a broken recap, even when generation fails.

**Non-goals (deferred)**
- On-demand recap regeneration / editing.
- A parent-facing transcript viewer or session history list.
- Hint chips, mid-session reconnect, transcript redaction/retention policy.

## 3. Key design decisions (from brainstorm)

1. **Generation strategy: post-session LLM summary.** Accumulate the transcript
   server-side during the session; at session end, make **one** non-streaming
   Gemini call that reads the transcript and returns the structured recap. The
   live audio model is not burdened with recap bookkeeping.
2. **Transcript: persisted** to the `sessions` table (jsonb). Feeds the
   summarizer and unlocks future replay/regeneration/debugging.
3. **Timing/UX: generate-then-reveal.** On End, the child immediately sees a
   "Pip is putting together what you learned!" loading state; the server
   generates the recap before signaling `'ended'`; the child then lands on a
   fully-populated `/app/recap`. No readiness-polling column needed.
4. **Recap prompt: externalized & tunable**, mirroring `study-buddy.md`. The
   summarizer's system instruction lives in an editable, hot-reloaded
   `apps/server/study-buddy-recap.md` with `{{token}}` placeholders, a
   byte-identical in-code `BUILTIN_RECAP_TEMPLATE` fallback, and a drift-guard
   test — exactly like the live persona prompt. The transcript is **not**
   interpolated into the template; it is passed as the model input (`contents`),
   keeping the template human-readable.

## 4. Data flow

```
Live session (relay forwards transcript deltas to client — UNCHANGED)
   │  ── NEW: relay also folds deltas into a server-side TranscriptAccumulator
   ▼
child taps End → client shows "Pip is putting together what you learned!"
   ▼
relay.finish('completed'):
   1. close the Gemini live session
   2. snapshot the accumulated transcript turns
   3. generateRecap(transcript, child, subject)  ← NEW non-streaming Gemini call
        · bounded by a timeout; on failure/timeout → graceful fallback recap
   4. finalize: write { state:'completed', endedAt, transcript, recap cols }
      in one update — the row flips to 'completed' only once fully populated
   5. commitLearningProfile (UNCHANGED)
   6. send status:'ended'
   ▼
client receives 'ended' → navigate to /app/recap → getRecap() returns populated row
```

Marking the row `completed` only **after** the recap columns are written avoids a
"completed-but-empty" read race. The endpoint already filters
`state='completed'`, so an in-flight session never surfaces a half-built recap.

## 5. Components

Each unit has one purpose, a clear interface, and is independently testable.

| Unit | Location | Responsibility |
|---|---|---|
| `TranscriptAccumulator` | `apps/server/src/voice/transcript.ts` (beside `stripTextArtifact`) | **Pure.** Fold role-tagged transcript deltas into ordered `{ role, text }` turns; close a turn on its `final` delta. Mirrors the browser `voiceReducer` accumulation. |
| `generateRecap()` | new `apps/server/src/recap/generateRecap.ts` | Load+render the recap system instruction; call Gemini non-streaming with the transcript as input and a structured-output schema; validate → `RecapResult`. Timeout + fallback live here. |
| Recap prompt template | `apps/server/study-buddy-recap.md` + `BUILTIN_RECAP_TEMPLATE` in `recap/recapPrompt.ts` | Editable, hot-reloaded markdown system instruction with `{{token}}` placeholders; byte-identical in-code fallback guarded by a drift test. Reuses the `study-buddy.md` loader pattern (`renderTemplate`/`loadTemplate`, headings stripped) — extract a small shared template helper rather than duplicating it. Tokens: `{{childName}}`, `{{grade}}`, `{{subject}}`, `{{topic}}`. |
| `finalizeLiveSession` (extended) | `apps/server/src/voice/sessionRow.ts` | Extended to write `transcript` + recap columns in the same update that sets `state='completed'` / `endedAt`. |
| `relay.ts` (extended) | `apps/server/src/voice/relay.ts` | Accumulate turns inside `events()`; orchestrate steps 3–4 in `finish()`. |
| Schema migration | `apps/server/src/db/schema.ts` + `apps/server/drizzle/` | Add `transcript jsonb` to `sessions`. (Recap columns already exist.) |
| `VoiceRoute.tsx` (changed) | `apps/web/src/routes/app/VoiceRoute.tsx` | New "wrapping up" state after End; navigate to `/app/recap` (not `/app`) on `'ended'` for went-live completed sessions. |

### Shared types

`RecapResult` and `RecapItem` already exist in `packages/shared/src/domain.ts`
and are unchanged. A transcript turn type (`{ role: 'pip' | 'child'; text: string }`)
is added to shared so client, accumulator, and DB agree on shape.

## 6. The summarizer call

- **System instruction:** rendered from `study-buddy-recap.md` with
  `{{childName}}`, `{{grade}}`, `{{subject}}`, `{{topic}}` substituted (the same
  loader/renderer the live persona prompt uses).
- **Model input (`contents`):** the full ordered transcript turns, serialized as
  a readable `Pip:` / `<childName>:` script — kept out of the template so the
  template stays editable prose.
- **Output (structured / `responseSchema`, defined in code):**
  `figuredOut: { ok, text }[]`, `solvedSelf`, `solvedTotal`, `starsEarned`,
  `insightTitle`, `insightBody`, `insightBadge`. `durationSeconds` and
  `subjectKind` come from the row (not the LLM). `starsMax` = constant **3**.
- **Model:** the current Gemini **flash text** model — exact id confirmed via the
  `gemini-api-dev` skill during planning. Reuses the existing `GoogleGenAI`
  dependency (already imported in `geminiSession.ts`) and `GEMINI_API_KEY`. No new
  deps or secrets.
- **Tone guidance (in the prompt):** K-5, warm, second-person ("You figured out
  how to carry the 1!"). `figuredOut` items use `ok:false` for things still shaky
  (renders as the amber "still unsure" row). `starsEarned` is **encouraging —
  never below 1**.

## 7. Failure & edge handling

- **LLM fails or times out** → write a **graceful degraded recap**: real duration
  + subject, `starsEarned:1` / `starsMax:3` (participation), one warm generic
  `figuredOut` item ("We had a great session together!"), and a generic
  encouraging insight. The child never sees a broken screen. (Chosen over showing
  the "No recap yet" empty state, which reads as failure after a real session.)
- **Abandoned sessions** (disconnect / Back) → persist the transcript, but **skip
  recap generation** (matches `commitLearningProfile`, which runs only on
  `completed`; the endpoint filters `state='completed'`, so abandoned sessions
  never surface a recap).
- **Near-empty transcript** (child barely spoke) → the summarizer is instructed to
  still return a minimal, encouraging recap rather than erroring.
- **Child navigates away during generation** → the server still completes
  generation and persists the recap; it is available next time the recap tab is
  opened.

## 8. Testing

- `TranscriptAccumulator` — pure unit tests: delta folding, interleaved
  pip/child roles, turn closing on `final`.
- `generateRecap` — unit tests with a **stubbed Gemini connector** (same
  dependency-injection style as the faked connector used for `makeGeminiConnector`
  in existing tests): prompt assembly, response validation, and the **fallback
  path** when the connector throws/times out. No live LLM in CI.
- Recap-template **drift guard** — a test asserting `study-buddy-recap.md` is
  byte-identical to `BUILTIN_RECAP_TEMPLATE` (mirrors the existing `study-buddy.md`
  guard), plus token-substitution/heading-strip coverage on the shared loader.
- `finalizeLiveSession` — DB test (throwaway host Postgres on 5433, per the
  `running-server-db-tests` convention) asserting `transcript` + recap columns
  persist and `state='completed'` is set atomically.
- Manual smoke — `docs/superpowers/SP6-manual-smoke.md` for the real
  mic → recap loop (needs a human mic run, like SP3).

## 9. Privacy

Persisting child conversation transcripts introduces new stored PII. Acceptable
within this dev project; the smoke doc will flag retention/redaction as a real
product concern for later.

## 10. Acceptance criteria

1. Completing a voice session writes the transcript and a populated recap to the
   `sessions` row, then routes the child to a fully-rendered `/app/recap`.
2. The "What we figured out", stars, "Solved it yourself", and "Pip noticed…"
   sections all show real, session-specific content.
3. A forced generation failure yields the degraded recap, not a broken screen or
   the empty state.
4. Abandoned sessions persist a transcript but generate no recap.
5. The live voice loop is byte-for-byte unchanged in behavior; existing SP3 tests
   still pass.
6. Server suite green (transcript accumulator, generateRecap incl. fallback,
   finalize persistence) and typecheck clean; web typecheck/build clean.
