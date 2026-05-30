# Study Buddy SP3 — Live Voice Tutor (Design Spec)

> **Status:** Approved design, ready for implementation planning.
> **Subsystem:** 3 of 5 (the hero). Built on top of SP1 (UI foundation) and SP2
> (backend + database), both merged to `main`.
> **Prereqs:** SP2's `sessions`, `learning_profiles`, and `learning_profile_traits`
> tables exist and are seeded; the Hono-on-Bun server and the React/Vite web app
> are running under `docker compose`.

## Goal

Make Pip talk. A K-5 student opens the Voice screen from a subject, speaks to
Pip, and Pip responds in real time with a warm voice — guiding **Socratically
(it guides, it never just gives the answer)**. The conversation is grounded in
the chosen subject and the child's current learning-style profile, and over the
course of the session Pip notices how the child learns best and nudges the
stored profile so future sessions adapt.

This subsystem is independently demoable: start a session → have a spoken
Socratic conversation with a live transcript → end → see the "How I learn"
profile shift.

## Scope

**In scope (SP3):**
- Real-time bidirectional audio: mic capture in the browser, Pip's native-audio
  voice played back, with open-mic barge-in (the child can interrupt Pip).
- A Hono-on-Bun **WebSocket relay** bridging `browser ⇄ our server ⇄ Gemini Live`.
  The Gemini API key stays server-side.
- A Socratic system prompt for Pip, assembled per session from the child, the
  subject/topic, and the learning profile.
- A live transcript (both the child's and Pip's turns) on the Voice screen.
- Learning-style detection via a Gemini **function call** that the relay
  accumulates during the session and commits to `learning_profile_traits` as
  bounded deltas in one transaction at session end.
- Session resilience: transparent resumption across Gemini's ~10-minute
  connection lifetime, and a ~10-minute **soft cap** where Pip gently wraps up.
- A real `sessions` row per live session (`in_progress` → `completed`/`abandoned`).

**Explicitly deferred (a later "SP3.5 / recap" effort):**
- Auto-generated session recap (the `sessions` recap fields —
  `starsEarned`, `figuredOut`, `insightTitle/Body/Badge` — stay null for
  SP3-created sessions).
- Persisting the transcript (live-only in SP3; the schema has no transcript
  column and gains none here).
- LLM-generated prose for the profile `note` (SP3 uses a templated sentence).
- Interactive hint chips (the static suggestion chips on the Voice screen).
- True subjectless "free talk" (see Session model below).

## Committed decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Relay architecture | **Thin server relay** — browser speaks our narrow WS envelope; only the server sees the Gemini protocol + API key. (Rejected: ephemeral-token direct-to-Gemini; partner frameworks like Pipecat/LiveKit.) |
| Session model | **Subject-grounded free dialogue** — no fixed question count; subject + topic + profile injected into the system prompt. |
| Audio mode | **Open mic + barge-in**, Gemini native audio output, server-side VAD. |
| Profile writes | **Accumulate live, commit at end** — bounded, clamped deltas in one transaction. |
| Resilience | **Resume + soft time cap (~10 min)** — transparent reconnect on Gemini connection resets; gentle wrap-up at the cap. |
| Transcript | **Live-only** (not persisted in SP3). |
| "Just talk with Pip" | **Route through a quick subject pick first** (keeps `sessions.subjectKind` honest, conversation grounded). |
| End button | **Navigates to Home** (`/app`), not Recap (recap generation deferred). |

## Gemini Live API facts grounding this design

Confirmed current via the `gemini-live-api-dev` skill:

- **Model:** `gemini-3.1-flash-live-preview` — recommended for all Live API use
  cases; native audio output; 128k context.
- **Modality:** `TEXT` *or* `AUDIO` per session, not both. We use `AUDIO`
  output and enable input + output **transcription** separately to get the live
  transcript text alongside Pip's voice.
- **Audio formats:** input = raw PCM, 16-bit, mono, **16 kHz**
  (`audio/pcm;rate=16000`); output = raw PCM, 16-bit, mono, **24 kHz**.
- **Function calling** is **synchronous** (the model waits for the tool
  response). Our learning-signal tool returns an immediate empty ack so it never
  stalls the dialogue. (Async function calling is not supported.)
- **Session resumption** is supported via handles; connection lifetime is
  ~10 min and audio-only sessions run 15 min uncompressed — so resumption is
  required, not optional.
- **VAD / barge-in:** automatic VAD; an `interrupted` signal arrives when the
  child barges in → clear the playback queue.
- **Auth:** API key stays server-side in a relay. Ephemeral tokens are only
  needed for browser-direct connections, which we are not doing.
- **SDK:** `@google/genai` (server-side, in `apps/server`).
- Not used / not available in this model: proactive audio, affective dialogue,
  code execution, URL context.

## Architecture

A vertical slice across all three packages, plus a browser-only audio concern.

```
packages/shared/
  src/voice.ts              WS envelope types + tool payload types (shared contract)

apps/server/
  src/voice/
    relay.ts                WS endpoint + per-connection orchestrator (state machine)
    geminiSession.ts        wraps @google/genai live session (connect/config/resume)
                            — behind an interface so tests inject a fake
    systemPrompt.ts         assembles Pip's Socratic instruction
    tools.ts                note_learning_signal declaration + ack handler
    profileCommit.ts        accumulate signals → bounded deltas → one transaction
    sessionRow.ts           create in_progress row; finalize completed/abandoned

apps/web/
  src/voice/
    useVoiceSession.ts      hook: opens WS, drives state machine, exposes transcript + status
    audioCapture.ts         mic → AudioWorklet → 16kHz PCM16 frames (pure, testable)
    audioPlayback.ts        24kHz PCM16 chunk queue → AudioContext; clear-on-interrupt
  src/routes/app/VoiceRoute.tsx   rewired from static mock → live hook
```

**Boundary discipline:**
- The browser never sees the Gemini protocol or the API key — it speaks *our*
  narrow envelope. The browser cannot express a system prompt, tool definition,
  or model config; those live only server-side. The relay is a **narrowing**
  proxy, not a transparent one — this is the security boundary made concrete.
- `geminiSession.ts` is the only file that knows the `@google/genai` shape. The
  relay orchestrates; it does not parse raw SDK internals elsewhere.
- `audioCapture.ts` / `audioPlayback.ts` are pure modules — no React, no Gemini —
  so the PCM math is unit-testable.

## The WebSocket protocol (browser ⇄ relay)

Endpoint: `GET /api/children/:childId/voice` (WebSocket upgrade), reusing the
existing `childContext` middleware for child validation.

A JSON envelope carries control; **binary frames** carry audio (so we don't
base64-inflate ~50 audio packets/sec over our own hop).

**Browser → relay**
- `{ type: "start", subjectKind, topic, title }` — open the session.
- *(binary frame)* — one 16 kHz PCM16 mic chunk.
- `{ type: "mute" }` / `{ type: "unmute" }` — pause/resume mic; on mute the relay
  sends `audioStreamEnd` to Gemini to flush.
- `{ type: "end" }` — the child tapped End.

**Relay → browser**
- `{ type: "ready" }` — Gemini connected; start capturing.
- *(binary frame)* — one 24 kHz PCM16 chunk of Pip's voice.
- `{ type: "transcript", role: "pip" | "child", text, final }` — incremental
  transcript.
- `{ type: "interrupted" }` — child barged in; browser clears its playback queue.
- `{ type: "status", state: "live" | "resuming" | "ended" }`.
- `{ type: "error", code, message }` — `mic-denied` (client-originated),
  `gemini-unavailable`, `connection-lost`.

These envelope types live in `packages/shared/src/voice.ts` and are imported by
both the relay and the web hook.

## Relay internals (`relay.ts`)

Per-connection state: the Gemini session handle, the latest resumption handle,
the accumulated learning signals, and the `sessions` row id. A small explicit
state machine: `connecting → live → (resuming ⇄ live) → ending → closed`.

**On `start`:**
1. Read the child's `learning_profiles` + traits and the chosen subject from
   Postgres.
2. Build the system instruction (`systemPrompt.ts`).
3. Connect to Gemini with: `responseModalities: ['audio']`,
   input + output transcription enabled, automatic VAD on, the
   `note_learning_signal` tool declared, strict safety settings, and
   `sessionResumption: {}` requested.
4. Insert the `in_progress` `sessions` row (`subjectKind`, `title`, `startedAt = now`).
5. Emit `ready`.

**Steady state:**
- Mic binary frames → `sendRealtimeInput({ audio })`.
- Gemini events are demuxed (process **all** parts per event):
  audio parts → binary frames out; `inputTranscription`/`outputTranscription`
  → `transcript` events; `interrupted` → `interrupted` event; tool calls →
  handled locally (below). Each `sessionResumptionUpdate.newHandle` is stored.

**Resumption:** a Gemini `GoAway`/socket close is **expected** (~10-min
lifetime), not an error. The relay reconnects with the stored handle, holding the
browser in `resuming`, then returns to `live` — the browser's own WS stays up, so
the child never notices. Only after **two** failed reconnects do we emit
`connection-lost` and finalize the row `abandoned`.

**Soft cap:** a server timer at **10 minutes** injects a system turn instructing
Pip to warm-wrap-up, then closes after Pip's closing turn. Bounds cost and screen
time without cutting off mid-sentence. (Sits under the 15-min uncompressed audio
limit; well-aligned with K-5 attention spans.)

**On `end` / cap / fatal drop:** finalize the `sessions` row (`completed` on
graceful end, `abandoned` on fatal drop, `endedAt = now`), run the profile commit,
close the Gemini session, close the browser WS.

## Pip's system prompt (`systemPrompt.ts`)

Assembled per session, carrying:
- **Persona:** a warm, patient, encouraging tutor for a young child; short,
  spoken-friendly sentences.
- **Socratic hard rule:** guide with questions and hints; **never** state the
  final answer. If the child is stuck, break the problem into a smaller step and
  ask again.
- **Grounding:** the chosen subject + topic (e.g., "Math — word problems").
- **Learning profile:** the child's current trait leanings ("Maya leans visual —
  favour drawing and picturing things; she also responds to short stories").
- **Age-appropriate language** for the child's grade.
- **Gentle redirect:** if the child goes off-topic or seems upset, steer back
  kindly; no moralizing or lecturing.

Backed by strict Gemini safety settings on the connection config.

## The learning-signal tool (`tools.ts`)

One synchronous function declaration:

```
note_learning_signal({
  trait: 'visual' | 'narrative' | 'kinesthetic' | 'auditory',
  strength: 'weak' | 'strong'
})
```

The prompt instructs Pip to call it when it **observes** the child responding
well to an approach (e.g., the child gets it after Pip suggests drawing →
`{ trait: 'visual', strength: 'strong' }`). The handler **records the signal in
session state and returns an immediate empty ack** — the tool is a side-channel
for observation, not a step in the dialogue, so the synchronous call never stalls
the audio.

## Profile commit (`profileCommit.ts`)

At session end, in **one transaction**:
1. Map signals to deltas: `weak = +2`, `strong = +5`.
2. Sum per trait.
3. **Clamp each trait's total session movement to ±10** — one chatty session
   can't slam a score; the profile drifts over many sessions rather than lurching.
4. Apply to stored `learning_profile_traits.score`, clamped to `0–100`.
5. Refresh `learning_profiles.note` with a **templated** sentence from the
   largest positive delta (e.g., "Lately you light up when we draw things out.").

The four trait rows already exist per child (seeded), so this is an update, not
an insert. LLM-generated prose notes are deferred.

## `sessions` row lifecycle (`sessionRow.ts`)

- **Create** on `start`: `state = 'in_progress'`, `subjectKind`, `title`,
  `startedAt = now`. Recap-specific fields left null.
- **Finalize** on end: `state = 'completed'` (graceful) or `'abandoned'`
  (fatal drop / failed resumption), `endedAt = now`.

This feeds the SP2 activity chart (completed sessions counted by `endedAt`)
naturally. No schema changes in SP3. A `sessions` row created by SP3 that is
later viewed on the Recap screen shows only duration + subject (recap fields
null) until the deferred recap work populates them — an accepted SP3 limitation.

## Web: Voice screen wiring

`VoiceRoute.tsx` is rewired from static mock to the `useVoiceSession` hook.

**Entry points** pass subject context via router state:
`navigate('/app/voice', { state: { subjectKind, topic, title } })` from Library
subject tiles, assignment **Start** buttons, and the Home/Dashboard continue
cards. **"Just talk with Pip"** shows a lightweight subject chooser first, then
proceeds with the picked subject.

**State → Pip mapping** (Pip already supports these states):
`connecting → curious`; child's turn → `listen`; Pip speaking → `speak`;
`resuming → idle` + a subtle "one sec…" chip; graceful end → `cheer`.

**UI changes to the existing screen:**
- Top bar: **subject · topic** (live) + a real session **timer**. The static
  "Question 3 of 5" line and the 5 progress dots are **dropped** (free dialogue
  has no fixed count); the existing listening/paused state chip remains.
- Transcript bubbles are driven by `transcript` events (rolling last few turns),
  replacing the hardcoded ones.
- Hint chips: interactivity **deferred** for SP3 — removed (or left visually
  disabled; decided at implementation).
- Mute / BigMic / End wired to `mute` / `unmute` / `end`.
- **End → navigates to Home** (`/app`). The session's visible effect is the
  updated "How I learn" (Profile) screen.

**Mic permission** is requested on `start`.

**Error UX** (friendly, reusing the `ErrorState` atom's tone):
- `mic-denied` — "Pip needs your microphone" explainer + retry.
- `gemini-unavailable` — Pip is having trouble; retry.
- `connection-lost` — after resume retries exhausted.

## Audio pipeline (web)

- **Capture (`audioCapture.ts`):** `getUserMedia` → `AudioContext` +
  `AudioWorklet` → downsample/format to 16 kHz PCM16 mono → emit binary frames
  to the hook, which forwards them over the WS.
- **Playback (`audioPlayback.ts`):** receive 24 kHz PCM16 chunks → enqueue →
  schedule onto an `AudioContext` for gapless playback. On `interrupted`, **clear
  the queue immediately** so Pip stops the moment the child speaks.

## Config & dependencies

- **Secret:** `GEMINI_API_KEY` — server-side only. Added to `.env.example` and
  the `server` service in `docker-compose.yml`. **Never** exposed to `apps/web`.
- **Dependency:** `@google/genai` added to `apps/server`.
- **WS transport:** Hono's Bun adapter (`createBunWebSocket` from `hono/bun`)
  wired into the existing `Bun.serve`, so the WS endpoint shares the HTTP API's
  port.

## Error handling summary

| Condition | Behavior |
|---|---|
| Mic permission denied | `error: mic-denied`; friendly retry; no session row created |
| Gemini connect fails at start | `error: gemini-unavailable`; row not created (or rolled back) |
| Gemini connection reset (expected ~10 min) | transparent resume via handle; browser shows `resuming` |
| Resume fails twice | `error: connection-lost`; row finalized `abandoned` |
| Soft cap (10 min) | Pip warm-wrap-up turn, then graceful close; row `completed` |
| Child barge-in | `interrupted` → browser clears playback queue |
| Child taps End | graceful close; row `completed`; profile commit; → Home |

## Testing strategy

The Gemini session sits behind an interface (`geminiSession.ts`) so tests inject
a **fake** that emits scripted events — no real API calls in the suite.

- **Unit (pure):**
  - `audioCapture` / `audioPlayback` — PCM resample/format math and queue behavior.
  - `profileCommit` — delta → sum → ±10-cap → 0–100-clamp logic (table-driven).
  - `systemPrompt` — assembly snapshot for a given child/subject/profile.
- **Integration** (extends the existing `bun test` harness against the test DB):
  drive `relay.ts` with the fake Gemini session and assert the WS envelope
  (`start → ready`, audio demux, transcript events, `interrupted`, tool call →
  ack + accumulation), the profile commit on end, and `sessions` row finalize
  (`completed` / `abandoned`).
- **Manual smoke checklist** (in the implementation plan's verification step):
  the real-audio loop — mic → Pip speaks → barge-in → resume → end — which can't
  be meaningfully automated.

## Out of scope / explicitly not built

- Auth / guardian ownership checks on the WS (SP4 — the WS reuses the same
  build-time `CURRENT_CHILD_ID` seam as the rest of the app).
- Recap auto-generation, transcript persistence, LLM-written profile notes,
  interactive hint chips, true subjectless free-talk (all deferred as noted).
- Video input, Google Search grounding, multi-child concurrency tuning.

## Open items for the implementation plan

- Exact `AudioWorklet` resampling approach and chunk size (latency vs overhead).
- Whether to enable Gemini context-window compression given the 10-min cap
  (likely unnecessary under the cap, but confirm).
- Final copy for Pip's system prompt and the templated profile note.
- Whether hint chips are removed or rendered disabled.
