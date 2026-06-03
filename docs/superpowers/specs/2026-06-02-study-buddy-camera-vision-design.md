# Study Buddy — Camera Vision / "Show Pip" (SP7) Design

**Date:** 2026-06-02
**Status:** Design approved; spec under review.
**Depends on:** SP3 (live voice tutor — the WS relay + Gemini Live session),
SP4 (auth — guardian-ownership authz in `childContext`), SP2 (Postgres + Drizzle,
the repository seam, the dashboard).

## 1. Problem & context

Pip is voice-only today. A K-5 student doing math, reading, or drawing often has
something **visual** in front of them — a worksheet, a textbook problem, a diagram
they drew, three apples they're counting — that Pip cannot see. The child has to
describe it in words, which is exactly the hardest thing for a young child to do,
and Pip is guiding blind.

The current live loop is already a multimodal-ready pipeline:

- **Client** (`apps/web/src/voice/useVoiceSession.ts`) opens a WebSocket to
  `/api/children/:childId/voice`, sends mic audio as raw binary PCM frames, and
  receives Pip's audio as binary frames + JSON control messages.
- **Relay** (`apps/server/src/voice/relay.ts`) forwards audio to Gemini via
  `session.sendAudio(...)` and bridges transcript/status/tool events back.
- **Gemini session** (`apps/server/src/voice/geminiSession.ts`) wraps
  `@google/genai` `ai.live.connect` and calls `sendRealtimeInput({ audio })`.

The Gemini Live API's `sendRealtimeInput` **also accepts image frames on the same
live session** (`{ video: { data, mimeType: 'image/jpeg' } }`), and the current
model `gemini-3.1-flash-live-preview` supports it (verified against the live Live
API docs, 2026-06-02). So "Pip can see" is **not a second AI integration** — it is
a new frame type flowing through the existing WS relay into the existing session.
Pip reacts to what it sees in the same audio conversation.

## 2. Goals / non-goals

**Goals**
- During a live session, a child can show Pip a photo of their work and Pip reacts
  to it in conversation.
- **Snapshot on demand**, not continuous video: the child captures a single frame,
  previews it, and confirms before it is sent — deliberate, cheap, privacy-friendly.
- Cover three uses: the child's **own work**, the **problem/textbook**, and
  **open-ended** "point at anything" (the child verbally names it; the audio
  channel carries that label for free).
- **The child always controls the shutter.** Pip can *invite* the camera but can
  never fire it.
- Each confirmed snapshot is **stored** and viewable by the guardian on the
  dashboard.
- **Pip's Socratic rule extends to vision:** even when the photo shows the answer,
  Pip guides — it never reads the answer out.
- Keep the live audio loop (browser ⇄ Hono WS ⇄ Gemini Live) otherwise untouched.

**Non-goals (deferred)**
- Continuous live video / always-on camera.
- OCR or structured extraction from the image.
- **webp** storage (single JPEG for v1; webp is a one-line future upgrade — see §10).
- Object storage (S3/R2); images live in Postgres `bytea` for v1.
- Image annotation/editing.
- Surfacing snapshot thumbnails in the **child's** recap (`/app/recap`) — v1 stores
  them for the **parent dashboard only**. Pip's spoken reaction already lands in the
  child's recap transcript.
- iOS/Android-native camera quirks; v1 targets the web (Chrome) `getUserMedia` path,
  consistent with how SP3/SP6 were verified.

## 3. Key design decisions (from brainstorm)

1. **Transport: reuse the existing voice WebSocket (Approach A).** The browser
   captures a JPEG and, after the child confirms, sends it over the *same* socket
   the mic uses. The relay forwards it to Gemini **and** persists it. One
   connection, one session, reuses all existing relay/auth/ownership plumbing.
   Rejected alternatives: a separate HTTP upload + cross-channel signal (two
   round-trips, more coordination, no benefit at our image sizes); an out-of-band
   vision call that injects a text description (Pip never truly "sees" it, doubles
   AI calls, adds latency — unnecessary now that live-session image input is
   confirmed).
2. **Capture model: snapshot on demand with preview + confirm.** Tap → freeze
   frame → `[Retake]` / `[Send to Pip]`. The confirm step matters more *because*
   images are stored: it prevents blurry/accidental shots (faces, the room) from
   being sent and saved.
3. **Image format: single JPEG, ~1024px longest edge, quality ~0.85, used for both
   Pip and storage.** Gemini tokenizes vision input in ~768px tiles, so beyond
   ~1024px/q0.85 a sharper image gives Pip **zero** extra comprehension — it only
   burns context tokens and bandwidth. JPEG is the format the Live API docs use for
   realtime image frames (`image/jpeg`); webp on the realtime `video` path is
   undocumented, so it is not used on the send path. The stored copy being byte-for-
   byte *what Pip saw* is a feature for the parent. webp-for-storage (better edge
   fidelity on handwriting, ~25–30% smaller) is a clean later upgrade: a different
   mime + bytes in the same table.
4. **Storage: Postgres `bytea` in a new `session_snapshots` table.** Least moving
   parts; reuses existing migrations, queries, and the SP4 guardian-ownership authz
   with no new infrastructure. JPEGs are small and low-volume (a few per session).
   Upgrade path to object storage later: swap a storage adapter, keep the table as
   metadata.
5. **Pip can invite the camera via function calling.** A new `offer_camera`
   declaration (sibling to the existing `note_learning_signal`) lets Pip signal "a
   picture would help here." The relay forwards a `camera-offered` control to the
   client. The camera button is **always visible** (the child's path); on
   `camera-offered` it **pulses + shows a "Tap to show me!" hint** (the Pip path).
   Pip can only invite — the child taps.
6. **Camera is optional, unlike the mic.** A denied camera permission shows an
   inline message and the session continues. The camera stream is opened only in
   capture mode and stopped immediately after (privacy parity with the mic).

## 4. Architecture & data flow

```
child taps 📷  (always-visible; pulses when Pip called offer_camera)
  → getUserMedia({ video: { facingMode: 'environment' } })  // rear camera
  → capture frame → preview screen [Retake] [Send to Pip]
  → on confirm: downscale → JPEG(≤1024px, q0.85) → base64
  → send over the existing voice WS:
        { type: 'snapshot', mime: 'image/jpeg', data: <base64> }   // JSON control
  → stop camera stream

relay.handleControl('snapshot')  (only when state === 'live')
  ├─ session.sendImage(base64)  → sendRealtimeInput({ video: {data, mimeType:'image/jpeg'} })
  └─ saveSnapshot(sessionId, childId, bytes, mime)   // INSERT session_snapshots
  └─ sink.sendControl({ type: 'snapshot-ack', ok })  // client shows "Pip is looking…" / error

Gemini "sees" the image → Pip responds in audio  (same loop as today)

Pip decides a visual would help
  → toolCall 'offer_camera'
  → relay acks tool + sink.sendControl({ type: 'camera-offered' })
  → client pulses the camera button + "Tap to show me!" hint

later: guardian on /dashboard
  → GET /api/children/:childId/sessions/:sessionId/snapshots   (childContext authz)
  → "What {child} showed Pip" thumbnail strip
```

**Transport detail.** The mic already streams raw binary PCM frames, so a bare
binary image frame would be ambiguous. The snapshot therefore travels as a **JSON
control message with base64 data** on the existing control channel, keeping audio
binary frames unambiguous. (Base64 ~33% overhead on a ~150KB JPEG is negligible and
one-shot, not streamed.)

## 5. Components & changes

### Shared contract — `packages/shared/src/voice.ts`
- `ClientControl` += `{ type: 'snapshot'; mime: 'image/jpeg'; data: string /*base64*/ }`
- `ServerControl` += `{ type: 'snapshot-ack'; ok: boolean }`
- `ServerControl` += `{ type: 'camera-offered' }`

### Client — `apps/web/src/voice/`
- **`SnapshotCapture.tsx`** (new): self-contained overlay component. Owns the
  camera `<video>` preview, the shutter, and the freeze-frame confirm
  (`[Retake]`/`[Send to Pip]`). Opens the camera stream on mount, stops it on
  unmount. One clear job; presentational.
- **`imageEncode.ts`** (new, small util): downscale a captured frame to ≤1024px
  longest edge and encode JPEG q0.85 → `Uint8Array`/base64. Unit-tested.
- **`useVoiceSession.ts`**: add a `sendSnapshot(base64)` action that ships the
  `snapshot` control over the existing `wsRef`. Handle `snapshot-ack` and
  `camera-offered` server messages (via the reducer).
- **`voiceReducer.ts`**: track `cameraOffered` (for the pulse/hint) and a transient
  "Pip is looking…" state from `snapshot-ack`.
- **`VoiceRoute.tsx`**: add the always-visible camera button to the live controls
  (beside mute/end); open `SnapshotCapture` as an overlay; wire the pulse/hint to
  `cameraOffered`. Reuse existing `pip-*` animation + design tokens.

### Server — `apps/server/src/voice/`
- **`geminiSession.ts`**: add `sendImage(jpegBase64: string)` to the
  `GeminiLiveSession` interface → `session.sendRealtimeInput({ video: { data,
  mimeType: 'image/jpeg' } })`. The fake connector (`fakeGeminiSession.ts`) records
  images for tests.
- **`tools.ts`**: add the `offer_camera` function declaration (optional `reason`
  string) next to `note_learning_signal`; register it in the connect config's
  `functionDeclarations`.
- **`relay.ts`**:
  - Handle the `snapshot` control — only when `state === 'live'`: validate
    mime + size (reject > ~2MB), `session.sendImage(...)`, `saveSnapshot(...)`,
    then `snapshot-ack`. A storage failure must **not** end the session (Pip still
    saw it) — log and continue.
  - Handle the `offer_camera` tool call: ack the tool (as with the signal tool) and
    `sink.sendControl({ type: 'camera-offered' })`.
- **`snapshots.ts`** (new): `saveSnapshot(sessionId, childId, bytes, mime)` and
  `listSnapshotsForSession(sessionId)`.

### Routes — `apps/server/src/routes/`
Two **child-scoped** endpoints, both behind the existing `childContext`
guardian-ownership authz (unowned child → 404, no session → 401 — no new auth
logic, reuse SP4):
- `GET /api/children/:childId/snapshots` → JSON `SnapshotMeta[]`
  (`{ id, sessionId, subjectKind, createdAt }`, newest first, limit 24).
- `GET /api/children/:childId/snapshots/:snapshotId` → image bytes with a pinned
  `Content-Type: image/jpeg` (allowlisted, never the raw stored mime),
  `X-Content-Type-Options: nosniff`, a CSP sandbox, and `Content-Disposition:
  inline` — safe for a plain `<img src>` and direct navigation.

> The dashboard has no session-detail/history surface yet (SP6 deferred it), so
> v1 ships a flat "What {child} showed Pip" panel fed by the list endpoint rather
> than a per-session strip. Per-session grouping is a later add.

### Database — Drizzle migration
New table `session_snapshots`:

| column      | type        | notes                                  |
|-------------|-------------|----------------------------------------|
| id          | uuid pk     |                                        |
| session_id  | uuid        | fk → sessions(id)                      |
| child_id    | uuid        | fk → children(id); denormalized for authz |
| image       | bytea       | the JPEG bytes (webp later = different mime+bytes) |
| mime        | text        | `'image/jpeg'`                         |
| created_at  | timestamptz | default now(); ordering                |

No change to existing tables.

### Prompt — `apps/server/study-buddy.md` (+ byte-identical `BUILTIN_TEMPLATE`)
Add a short section (same `{{token}}` template pattern):
- Pip **may suggest** showing work and may call `offer_camera` when a visual would
  help (child stuck on something spatial/visual, mentions a drawing/worksheet,
  counting objects). Pip can only invite; the child taps.
- When an image arrives, Pip describes what it notices and asks about it.
- **Socratic rule explicitly extends to vision:** if the photo shows the answer,
  Pip must not state it — it guides the child to it. This is the one genuinely new
  behavioral risk, so it gets explicit language.
- Keep `BUILTIN_TEMPLATE` byte-identical; the existing drift-guard test covers it.

## 6. The Socratic-vision risk

The sharpest new failure mode: Pip sees a worksheet with "7 × 8 = 56" printed and
just says "the answer is 56." This defeats the product's core principle. Mitigation
is prompt-level (explicit instruction in §5's prompt section) and is the primary
thing the manual smoke (§8) must check: show Pip a problem whose answer is visible
and confirm Pip still guides rather than reads it out.

## 7. Error handling

| Failure | Behavior |
|---|---|
| Camera permission denied | Inline message in `SnapshotCapture`; **session continues** (camera optional). |
| Blank/oversized frame | Client rejects before send. |
| Relay: bad mime / > 2MB | Drop; `snapshot-ack {ok:false}`; session continues. |
| Storage write fails | Log; Pip still received the image; `snapshot-ack {ok:true}`; session continues. |
| `sendImage` to Gemini fails | Surface existing `gemini-unavailable` path; session not crashed. |
| Snapshot arrives when not `live` | Ignored (mirrors `handleAudio`). |

## 8. Testing

- **Server unit** (host vs throwaway PG on 5433, per the running-server-db-tests
  note): relay forwards `snapshot` to `sendImage` only when live; persists a row;
  survives a storage failure; rejects oversized/bad-mime; `offer_camera` tool call
  emits `camera-offered`. Fake Gemini connector records images.
- **Shared/contract:** new message types round-trip.
- **Prompt drift-guard:** existing test keeps `study-buddy.md` ↔ `BUILTIN_TEMPLATE`
  in lockstep.
- **Web unit:** `imageEncode` downscale/encode; reducer handling of `snapshot-ack`
  and `camera-offered`.
- **Manual smoke (`SP7-manual-smoke.md`)** — camera capture needs a real device, so
  this is a human run (like SP3/SP6): happy path (show work → Pip reacts → snapshot
  on dashboard), the **Socratic-vision check** (§6), the Pip-invited `offer_camera`
  pulse, preview/retake, permission-denied continues, and the dashboard viewer with
  ownership authz (a second guardian gets 404).

## 9. Privacy & security

- Camera stream opened only in capture mode, stopped immediately after — parity
  with the mic.
- The child always controls the shutter; Pip can only invite.
- Preview + confirm before anything is sent or stored.
- Stored images are guardian-only, gated by the existing `childContext`
  ownership authz (the SP4 IDOR fix already protects this route shape).
- v1 retention: snapshots persist with the session (no auto-expiry). A retention/
  deletion policy and a "delete this photo" control are noted as future work.

## 10. Out of scope / future (clean later increments)

- webp storage (different mime+bytes, same table) for crisper dashboard images.
- Snapshot thumbnails in the child's `/app/recap`.
- Object storage + signed URLs.
- OCR/structured extraction; continuous video; annotation.
- Guardian "delete snapshot" + retention policy.

## 11. Why this is a single, well-bounded subsystem (SP7)

It rides entirely on infrastructure already built and verified: the SP3 relay/live
session, the SP4 ownership authz, the SP2 Drizzle schema + dashboard, and the SP3
tunable-prompt pattern. The new surface is small and isolated — one client overlay
component + one util, three new contract messages, one relay branch + one tool, one
table + one read route, and a prompt section. Each piece has one clear job and a
defined interface, and the whole thing is independently demoable.
