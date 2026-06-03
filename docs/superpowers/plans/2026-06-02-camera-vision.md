# Camera Vision ("Show Pip", SP7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a K-5 student show Pip a photo of their work during a live voice session; Pip sees it on the same Gemini Live session and reacts, and each snapshot is stored for a guardian-only dashboard view.

**Architecture:** Snapshot-on-demand rides the existing voice WebSocket as a JSON control message (base64 JPEG). The relay forwards it to Gemini via `sendRealtimeInput({ video })` and persists it to a new `session_snapshots` (Postgres `bytea`) table. Pip can invite the camera via a new `offer_camera` function-calling tool. Read endpoints are child-scoped behind the existing SP4 `childContext` ownership authz; a flat "What {child} showed Pip" dashboard panel renders thumbnails.

**Tech Stack:** Hono + `@hono/bun` WS, `@google/genai` Live API (`gemini-3.1-flash-live-preview`), Drizzle ORM + Postgres, React 18 + Vite + Tailwind, Bun test.

**Spec:** `docs/superpowers/specs/2026-06-02-study-buddy-camera-vision-design.md`

> **Deviation from spec (flagged for the author):** the spec described a *per-session* snapshot strip on a session-detail view. The dashboard has **no** session-detail/history surface today (SP6 deferred it), so building one is out of scope. This plan instead exposes **child-scoped** read endpoints (`GET /children/:childId/snapshots` + `.../snapshots/:id`) and a flat dashboard panel. The per-session endpoints in spec §5 are replaced by these; everything else matches the spec. The spec file is updated to match in Task 16.

**Environment notes (carry forward):**
- `docker` is at `/usr/local/bin` (`export PATH="/usr/local/bin:$PATH"`).
- Server tests run **on the host** vs a throwaway Postgres on **5433**: from `apps/server`, `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test` (start `sb-test-pg` if stopped: `docker start sb-test-pg`).
- Server typecheck: `cd apps/server && bun run typecheck`. Web: `pnpm --filter @study-buddy/web typecheck` and `pnpm --filter @study-buddy/web build`. Web unit tests: `cd apps/web && bun test`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Shared contract — new message types + SnapshotMeta

**Files:**
- Modify: `packages/shared/src/voice.ts`

- [ ] **Step 1: Add the three control messages and the SnapshotMeta type**

In `packages/shared/src/voice.ts`, add `snapshot` to `ClientControl`:

```ts
/** Browser → relay control messages. Audio is sent separately as binary frames. */
export type ClientControl =
  | { type: 'start'; subjectKind: SubjectKind; topic: string; title: string }
  | { type: 'mute' }
  | { type: 'unmute' }
  | { type: 'snapshot'; mime: 'image/jpeg'; data: string /* base64, no data-URL prefix */ }
  | { type: 'end' };
```

Add `snapshot-ack` and `camera-offered` to `ServerControl`:

```ts
/** Relay → browser control messages. Audio is sent separately as binary frames. */
export type ServerControl =
  | { type: 'ready' }
  | { type: 'transcript'; role: 'pip' | 'child'; text: string; final: boolean }
  | { type: 'interrupted' }
  | { type: 'status'; state: VoiceStatus }
  | { type: 'snapshot-ack'; ok: boolean }
  | { type: 'camera-offered' }
  | { type: 'error'; code: VoiceErrorCode; message: string };
```

At the end of the file, add the dashboard metadata type:

```ts
/** Metadata for one stored snapshot, listed on the guardian dashboard. */
export interface SnapshotMeta {
  id: string;
  sessionId: string;
  subjectKind: SubjectKind;
  createdAt: string; // ISO timestamp
}
```

- [ ] **Step 2: Typecheck the shared package compiles**

Run: `cd apps/server && bun run typecheck`
Expected: PASS (no type errors; `ClientControl`/`ServerControl` now include the new members).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/voice.ts
git commit -m "feat(sp7): snapshot + camera-offered voice contract messages + SnapshotMeta"
```

---

### Task 2: Database — `session_snapshots` table + migration

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create (generated): `apps/server/drizzle/0004_*.sql`

- [ ] **Step 1: Add a `bytea` custom type and the table**

In `apps/server/src/db/schema.ts`, add `customType` to the `drizzle-orm/pg-core` import:

```ts
import {
  pgTable, uuid, text, integer, date, timestamp, jsonb, check, uniqueIndex, index, boolean, customType,
} from 'drizzle-orm/pg-core';
```

Near the top (after the `timestamps` helper), define the `bytea` type:

```ts
/** Postgres bytea ↔ Node Buffer. node-postgres returns bytea columns as Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});
```

At the end of the file (after `learningProfileTraits`), add the table:

```ts
// Camera snapshots a child showed Pip during a live session (SP7). bytea keeps
// the image inside the DB/authz model; child_id is denormalized for ownership
// checks without a join.
export const sessionSnapshots = pgTable(
  'session_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
    childId: uuid('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
    image: bytea('image').notNull(),
    mime: text('mime').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    childCreatedIdx: index('session_snapshots_child_created_idx').on(t.childId, t.createdAt.desc()),
  }),
);
```

- [ ] **Step 2: Generate the migration**

Run: `cd apps/server && bun run db:generate`
Expected: a new file `apps/server/drizzle/0004_<name>.sql` containing `CREATE TABLE "session_snapshots"` with an `image "bytea" NOT NULL` column and the index.

- [ ] **Step 3: Verify the SQL looks right**

Run: `ls apps/server/drizzle && grep -i "session_snapshots\|bytea" apps/server/drizzle/0004_*.sql`
Expected: shows the new table + `bytea` column.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle
git commit -m "feat(sp7): session_snapshots table (bytea) + migration"
```

---

### Task 3: Snapshot persistence module

**Files:**
- Create: `apps/server/src/voice/snapshots.ts`
- Test: `apps/server/test/voice/snapshots.db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/voice/snapshots.db.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';
import { ensureVoiceTestChild, VOICE_TEST_CHILD_ID } from './fixtures';
import { createLiveSession } from '../../src/voice/sessionRow';
import {
  saveSnapshot, listRecentSnapshotsForChild, getSnapshotForChild,
} from '../../src/voice/snapshots';

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  await ensureVoiceTestChild();
});

describe('snapshots persistence', () => {
  it('saves, lists, and reads back a snapshot for the owning child', async () => {
    const sessionId = await createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Snapshot test');
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]); // fake JPEG magic + body
    const id = await saveSnapshot(sessionId, VOICE_TEST_CHILD_ID, bytes, 'image/jpeg');
    expect(id).toBeTruthy();

    const list = await listRecentSnapshotsForChild(VOICE_TEST_CHILD_ID, 24);
    const mine = list.find((s) => s.id === id);
    expect(mine).toBeTruthy();
    expect(mine!.subjectKind).toBe('math');
    expect(mine!.sessionId).toBe(sessionId);

    const got = await getSnapshotForChild(VOICE_TEST_CHILD_ID, id);
    expect(got).not.toBeNull();
    expect(got!.mime).toBe('image/jpeg');
    expect(Buffer.from(got!.bytes).equals(bytes)).toBe(true);
  });

  it('returns null for a non-owning child and for a bad id', async () => {
    const sessionId = await createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Owner test');
    const id = await saveSnapshot(sessionId, VOICE_TEST_CHILD_ID, Buffer.from([1, 2, 3]), 'image/jpeg');
    const other = '00000000-0000-0000-0000-0000000000aa';
    expect(await getSnapshotForChild(other, id)).toBeNull();
    expect(await getSnapshotForChild(VOICE_TEST_CHILD_ID, 'not-a-uuid')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/snapshots.db.test.ts`
Expected: FAIL — `Cannot find module '../../src/voice/snapshots'`.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/voice/snapshots.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { sessionSnapshots, sessions } from '../db/schema';
import type { SnapshotMeta } from '@study-buddy/shared';

/** Insert one snapshot; returns its id. */
export async function saveSnapshot(
  sessionId: string,
  childId: string,
  bytes: Buffer,
  mime: string,
): Promise<string> {
  const [row] = await db
    .insert(sessionSnapshots)
    .values({ sessionId, childId, image: bytes, mime })
    .returning({ id: sessionSnapshots.id });
  return row.id;
}

/** Recent snapshots for a child (newest first), with their session's subject. */
export async function listRecentSnapshotsForChild(
  childId: string,
  limit: number,
): Promise<SnapshotMeta[]> {
  const rows = await db
    .select({
      id: sessionSnapshots.id,
      sessionId: sessionSnapshots.sessionId,
      subjectKind: sessions.subjectKind,
      createdAt: sessionSnapshots.createdAt,
    })
    .from(sessionSnapshots)
    .innerJoin(sessions, eq(sessionSnapshots.sessionId, sessions.id))
    .where(eq(sessionSnapshots.childId, childId))
    .orderBy(desc(sessionSnapshots.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    subjectKind: r.subjectKind as SnapshotMeta['subjectKind'],
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Read one snapshot's bytes, but ONLY if it belongs to `childId` (authz). */
export async function getSnapshotForChild(
  childId: string,
  snapshotId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const parsed = z.string().uuid().safeParse(snapshotId);
  if (!parsed.success) return null;
  const [row] = await db
    .select({ image: sessionSnapshots.image, mime: sessionSnapshots.mime })
    .from(sessionSnapshots)
    .where(and(eq(sessionSnapshots.id, parsed.data), eq(sessionSnapshots.childId, childId)))
    .limit(1);
  return row ? { bytes: row.image, mime: row.mime } : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/snapshots.db.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/snapshots.ts apps/server/test/voice/snapshots.db.test.ts
git commit -m "feat(sp7): snapshot persistence module (save/list/read with child authz)"
```

---

### Task 4: `offer_camera` function-calling tool declaration

**Files:**
- Modify: `apps/server/src/voice/tools.ts`
- Test: `apps/server/test/voice/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/voice/tools.test.ts`:

```ts
import { offerCameraDeclaration } from '../../src/voice/tools';

describe('offer_camera declaration', () => {
  it('is named offer_camera and takes no required args', () => {
    expect(offerCameraDeclaration.name).toBe('offer_camera');
    expect(offerCameraDeclaration.parameters?.required ?? []).toEqual([]);
  });
});
```

(If `tools.test.ts` does not already import `describe/it/expect`, add `import { describe, it, expect } from 'bun:test';` at the top — check first.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/tools.test.ts`
Expected: FAIL — `offerCameraDeclaration` is not exported.

- [ ] **Step 3: Add the declaration**

In `apps/server/src/voice/tools.ts`, after `noteLearningSignalDeclaration`, add:

```ts
export const offerCameraDeclaration: FunctionDeclaration = {
  name: 'offer_camera',
  description:
    'Invite the child to show you a picture of their work (a drawing, worksheet, ' +
    'book page, or real objects) when seeing it would help. This only highlights ' +
    'the camera button for the child — they still tap to take the picture. ' +
    'Keep talking naturally; do not mention the tool.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: {
        type: Type.STRING,
        description: 'Optional short note on why a picture would help.',
      },
    },
    required: [],
  },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/tools.ts apps/server/test/voice/tools.test.ts
git commit -m "feat(sp7): offer_camera tool declaration"
```

---

### Task 5: `sendImage` on the Gemini session + register the tool

**Files:**
- Modify: `apps/server/src/voice/geminiSession.ts`
- Modify: `apps/server/src/voice/fakeGeminiSession.ts`

- [ ] **Step 1: Add `sendImage` to the session interface + real impl + register the tool**

In `apps/server/src/voice/geminiSession.ts`:

Add `sendImage` to the interface:

```ts
/** What the relay can do to a live session. */
export interface GeminiLiveSession {
  sendAudio(pcm16k: Uint8Array): void;
  sendImage(jpegBase64: string): void;
  sendText(text: string): void;
  ackTool(id: string, name: string): void;
  audioStreamEnd(): void;
  close(): Promise<void>;
}
```

Import the new declaration and register it. Change the import line:

```ts
import { noteLearningSignalDeclaration, offerCameraDeclaration } from './tools';
```

In the `config`, update `tools`:

```ts
        tools: [{ functionDeclarations: [noteLearningSignalDeclaration, offerCameraDeclaration] }],
```

In the returned session object, add `sendImage` next to `sendAudio`:

```ts
      sendImage: (b64) =>
        session.sendRealtimeInput({ video: { data: b64, mimeType: 'image/jpeg' } }),
```

- [ ] **Step 2: Add `sendImage` to the fake**

In `apps/server/src/voice/fakeGeminiSession.ts`, extend the `sent` record type and object:

```ts
  sent: { audio: Uint8Array[]; images: string[]; text: string[]; acks: string[]; closed: boolean; audioEnded: boolean };
```

```ts
  const sent = { audio: [] as Uint8Array[], images: [] as string[], text: [] as string[], acks: [] as string[], closed: false, audioEnded: false };
```

Add the method to the `session` object:

```ts
    sendImage: (b64) => sent.images.push(b64),
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/server && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/voice/geminiSession.ts apps/server/src/voice/fakeGeminiSession.ts
git commit -m "feat(sp7): sendImage on the live session + register offer_camera tool"
```

---

### Task 6: Relay — handle `snapshot` control + `offer_camera` tool call

**Files:**
- Modify: `apps/server/src/voice/relay.ts`
- Test: `apps/server/test/voice/relay.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/voice/relay.test.ts` (inside the `describe('voice relay', ...)` block). Add the import at the top of the file with the others:

```ts
import { listRecentSnapshotsForChild } from '../../src/voice/snapshots';
```

Tests:

```ts
  it('forwards a snapshot to the live session and persists it', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Shapes', title: 'Shapes' });

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x10, 0x20]).toString('base64');
    await relay.handleControl({ type: 'snapshot', mime: 'image/jpeg', data: jpeg });

    expect(fake.sent.images).toHaveLength(1);
    expect(fake.sent.images[0]).toBe(jpeg);
    expect(out.control).toContainEqual({ type: 'snapshot-ack', ok: true });

    const list = await listRecentSnapshotsForChild(VOICE_TEST_CHILD_ID, 24);
    expect(list.length).toBeGreaterThan(0);
  });

  it('rejects a non-jpeg snapshot without forwarding it', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Shapes', title: 'Shapes' });

    // @ts-expect-error — deliberately wrong mime to exercise validation
    await relay.handleControl({ type: 'snapshot', mime: 'image/png', data: 'AAAA' });

    expect(fake.sent.images).toHaveLength(0);
    expect(out.control).toContainEqual({ type: 'snapshot-ack', ok: false });
  });

  it('emits camera-offered and acks the tool when Pip calls offer_camera', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Shapes', title: 'Shapes' });
    const ev = await fake.events();

    ev.onToolCall('call-1', 'offer_camera', {});

    expect(out.control).toContainEqual({ type: 'camera-offered' });
    expect(fake.sent.acks).toContain('offer_camera');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: FAIL — relay does not handle `snapshot` or `offer_camera` yet (no `snapshot-ack`/`camera-offered` emitted).

- [ ] **Step 3: Implement in the relay**

In `apps/server/src/voice/relay.ts`:

Add the import near the other `./` imports:

```ts
import { saveSnapshot } from './snapshots';
```

Add a size constant near `SOFT_CAP_MS`:

```ts
const MAX_SNAPSHOT_BYTES = 2_000_000; // ~2MB decoded; a 1024px q0.85 JPEG is far smaller
```

In the `events()` `onToolCall`, add an `offer_camera` branch (keep the existing signal + ack lines):

```ts
      onToolCall: (id, name, args) => {
        if (name === 'note_learning_signal') signals.addRaw(args);
        if (name === 'offer_camera') sink.sendControl({ type: 'camera-offered' });
        session?.ackTool(id, name);
      },
```

Add a `handleSnapshot` function inside `createRelay` (next to `finish`):

```ts
  async function handleSnapshot(mime: string, data: string) {
    if (state !== 'live' || !session || !sessionRowId) return;
    if (mime !== 'image/jpeg') { sink.sendControl({ type: 'snapshot-ack', ok: false }); return; }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_SNAPSHOT_BYTES) {
      sink.sendControl({ type: 'snapshot-ack', ok: false });
      return;
    }
    // Forward to Pip first (the conversational value); persistence is best-effort.
    session.sendImage(data);
    try {
      await saveSnapshot(sessionRowId, childId, bytes, mime);
    } catch (e) {
      console.error('[snapshot] save failed', e);
    }
    sink.sendControl({ type: 'snapshot-ack', ok: true });
  }
```

In the returned `handleControl` switch, add the `snapshot` case:

```ts
        case 'snapshot': await handleSnapshot(msg.mime, msg.data); break;
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: PASS (existing relay tests + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/relay.ts apps/server/test/voice/relay.test.ts
git commit -m "feat(sp7): relay handles snapshot (forward+persist) and offer_camera"
```

---

### Task 7: Read route — child-scoped snapshot endpoints

**Files:**
- Create: `apps/server/src/routes/snapshots.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/api.smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/api.smoke.test.ts` a new describe block. Reuse the file's existing `app`, `cookie`, and `MAYA_ID` (confirm their names at the top of the file; they are used by the existing session/recap tests). Add `makeGuardian` to the imports if not present:

```ts
describe('GET /api/children/:childId/snapshots', () => {
  it('lists snapshots for the owning guardian (empty array is valid)', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/snapshots`, { headers: { Cookie: cookie } }),
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('404s an unknown snapshot id', async () => {
    const res = await app.fetch(
      new Request(
        `http://test/api/children/${MAYA_ID}/snapshots/00000000-0000-0000-0000-0000000000ff`,
        { headers: { Cookie: cookie } },
      ),
    );
    expect(res.status).toBe(404);
  });

  it('401s the list without a session cookie', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/snapshots`),
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/api.smoke.test.ts`
Expected: FAIL — the `/snapshots` routes return 404 (not mounted), so the list assertion (`200`) fails.

- [ ] **Step 3: Create the route**

Create `apps/server/src/routes/snapshots.ts`:

```ts
import { Hono } from 'hono';
import type { ChildVariables } from '../lib/childContext';
import { listRecentSnapshotsForChild, getSnapshotForChild } from '../voice/snapshots';

export const snapshotsRoute = new Hono<{ Variables: ChildVariables }>()
  .get('/:childId/snapshots', async (c) => {
    const child = c.get('child');
    const rows = await listRecentSnapshotsForChild(child.id, 24);
    return c.json(rows);
  })
  .get('/:childId/snapshots/:snapshotId', async (c) => {
    const child = c.get('child');
    const snap = await getSnapshotForChild(child.id, c.req.param('snapshotId'));
    if (!snap) {
      return c.json({ error: { code: 'snapshot_not_found', message: 'No such snapshot' } }, 404);
    }
    return new Response(new Uint8Array(snap.bytes), {
      headers: { 'Content-Type': snap.mime, 'Cache-Control': 'private, max-age=3600' },
    });
  });
```

- [ ] **Step 4: Mount it**

In `apps/server/src/index.ts`, add the import with the other route imports:

```ts
import { snapshotsRoute } from './routes/snapshots';
```

After the line `api.route('/children', voiceRoute);`, add:

```ts
api.route('/children', snapshotsRoute);
```

(It is under the existing `api.use('/children/:childId/*', childContext)` guard, so ownership authz applies automatically.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/api.smoke.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/snapshots.ts apps/server/src/index.ts apps/server/test/api.smoke.test.ts
git commit -m "feat(sp7): child-scoped snapshot read endpoints behind childContext authz"
```

---

### Task 8: Web — image encode util

**Files:**
- Create: `apps/web/src/voice/imageEncode.ts`
- Test: `apps/web/src/voice/imageEncode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/voice/imageEncode.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { computeTargetSize } from './imageEncode';

describe('computeTargetSize', () => {
  it('scales the longest edge down to maxEdge, preserving aspect ratio', () => {
    expect(computeTargetSize(2000, 1000, 1024)).toEqual({ w: 1024, h: 512 });
    expect(computeTargetSize(1000, 2000, 1024)).toEqual({ w: 512, h: 1024 });
  });
  it('leaves images already within maxEdge unchanged', () => {
    expect(computeTargetSize(800, 600, 1024)).toEqual({ w: 800, h: 600 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && bun test src/voice/imageEncode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/voice/imageEncode.ts`:

```ts
/** Scale (w,h) so the longest edge ≤ maxEdge, preserving aspect ratio. */
export function computeTargetSize(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w, h };
  const scale = maxEdge / longest;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/**
 * Draw a video frame to a canvas, downscale to ≤maxEdge, and return base64 JPEG
 * (no data-URL prefix). Gemini tokenizes images at ~768px tiles, so 1024px/q0.85
 * is plenty — larger only costs tokens.
 */
export function captureJpegFromVideo(
  video: HTMLVideoElement,
  maxEdge = 1024,
  quality = 0.85,
): string {
  const { w, h } = computeTargetSize(video.videoWidth, video.videoHeight, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas context');
  ctx.drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return dataUrl.split(',')[1] ?? '';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && bun test src/voice/imageEncode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/voice/imageEncode.ts apps/web/src/voice/imageEncode.test.ts
git commit -m "feat(sp7): web image downscale+JPEG encode util"
```

---

### Task 9: Web — voice reducer: `cameraOffered`

**Files:**
- Modify: `apps/web/src/voice/voiceReducer.ts`
- Test: `apps/web/src/voice/voiceReducer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/voice/voiceReducer.test.ts`:

```ts
describe('camera offer', () => {
  it('sets cameraOffered on camera-offered and clears it on camera-consumed', () => {
    let s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'camera-offered' } });
    expect(s.cameraOffered).toBe(true);
    s = voiceReducer(s, { kind: 'camera-consumed' });
    expect(s.cameraOffered).toBe(false);
  });
  it('ignores snapshot-ack without throwing', () => {
    const s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'snapshot-ack', ok: true } });
    expect(s).toEqual(initialVoiceState);
  });
});
```

(Ensure `voiceReducer` and `initialVoiceState` are imported at the top of the test file — they are used by existing tests.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && bun test src/voice/voiceReducer.test.ts`
Expected: FAIL — `cameraOffered` undefined / `camera-consumed` action unhandled.

- [ ] **Step 3: Implement**

In `apps/web/src/voice/voiceReducer.ts`:

Add to `VoiceState`:

```ts
export interface VoiceState {
  status: 'idle' | 'connecting' | 'ending' | VoiceStatus;
  turns: Turn[];
  error: VoiceErrorCode | null;
  cameraOffered: boolean;
}
```

Update the initial state:

```ts
export const initialVoiceState: VoiceState = { status: 'idle', turns: [], error: null, cameraOffered: false };
```

Add the client action:

```ts
export type VoiceAction =
  | { kind: 'server'; msg: ServerControl }
  | { kind: 'connecting' }
  | { kind: 'ending' }
  | { kind: 'camera-consumed' };
```

Handle `camera-consumed` near the top (with the other non-server actions):

```ts
  if (action.kind === 'camera-consumed') return { ...state, cameraOffered: false };
```

Add cases in the server `switch`:

```ts
    case 'camera-offered':
      return { ...state, cameraOffered: true };
    case 'snapshot-ack':
      return state;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && bun test src/voice/voiceReducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/voice/voiceReducer.ts apps/web/src/voice/voiceReducer.test.ts
git commit -m "feat(sp7): voice reducer tracks cameraOffered"
```

---

### Task 10: Web — `useVoiceSession`: `sendSnapshot` + `consumeCameraOffer`

**Files:**
- Modify: `apps/web/src/voice/useVoiceSession.ts`

- [ ] **Step 1: Add the two actions and expose them**

In `apps/web/src/voice/useVoiceSession.ts`, add inside the hook (after `mute`/`unmute`):

```ts
  const sendSnapshot = useCallback((base64: string) => {
    send({ type: 'snapshot', mime: 'image/jpeg', data: base64 });
  }, []);

  const consumeCameraOffer = useCallback(() => {
    dispatch({ kind: 'camera-consumed' });
  }, []);
```

Update the returned object:

```ts
  return { state, start, end, mute, unmute, sendSnapshot, consumeCameraOffer };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/voice/useVoiceSession.ts
git commit -m "feat(sp7): useVoiceSession exposes sendSnapshot + consumeCameraOffer"
```

---

### Task 11: Web — `SnapshotCapture` overlay component

**Files:**
- Create: `apps/web/src/voice/SnapshotCapture.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/voice/SnapshotCapture.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { captureJpegFromVideo } from './imageEncode';

interface Props {
  onCapture: (base64Jpeg: string) => void;
  onClose: () => void;
}

/**
 * Full-screen camera overlay: live preview → freeze-frame → confirm.
 * The camera stream is opened on mount and stopped on unmount (privacy parity
 * with the mic). The child always taps to capture; nothing is sent until they
 * confirm. The camera is optional — a denied permission shows a message and the
 * voice session keeps going.
 */
export function SnapshotCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [frozen, setFrozen] = useState<string | null>(null); // base64 JPEG once captured
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setDenied(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function takePhoto() {
    if (!videoRef.current) return;
    setFrozen(captureJpegFromVideo(videoRef.current));
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-ink/95">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="font-display font-extrabold text-[16px] text-white">Show Pip</div>
        <button
          type="button"
          aria-label="Close camera"
          className="w-9 h-9 rounded-full bg-white/15 text-white flex items-center justify-center cursor-pointer border-0"
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M6 6 L18 18 M18 6 L6 18" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center px-5 min-h-0">
        {denied ? (
          <div className="text-center text-white/90 font-body font-semibold text-[15px] px-6">
            Pip needs camera permission to see your work. You can still keep talking!
          </div>
        ) : frozen ? (
          <img
            src={`data:image/jpeg;base64,${frozen}`}
            alt="Captured preview"
            className="max-h-full max-w-full rounded-[18px] object-contain"
          />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-full max-w-full rounded-[18px] object-contain"
          />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 px-6 py-6">
        {frozen ? (
          <>
            <button
              type="button"
              className="px-6 py-3 rounded-full bg-white/15 text-white font-display font-bold text-[15px] cursor-pointer border-0"
              onClick={() => setFrozen(null)}
            >
              Retake
            </button>
            <button
              type="button"
              className="px-6 py-3 rounded-full bg-coral text-white font-display font-extrabold text-[15px] cursor-pointer border-0"
              style={{ boxShadow: '0 4px 0 var(--color-coral-d)' }}
              onClick={() => onCapture(frozen)}
            >
              Send to Pip
            </button>
          </>
        ) : !denied ? (
          <button
            type="button"
            aria-label="Take photo"
            className="w-[72px] h-[72px] rounded-full bg-white cursor-pointer border-[5px] border-white/40"
            onClick={takePhoto}
          />
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/voice/SnapshotCapture.tsx
git commit -m "feat(sp7): SnapshotCapture camera overlay (preview + confirm)"
```

---

### Task 12: Web — wire the camera button + overlay into `VoiceRoute`

**Files:**
- Modify: `apps/web/src/routes/app/VoiceRoute.tsx`

- [ ] **Step 1: Import the overlay and pull the new hook values**

At the top of `apps/web/src/routes/app/VoiceRoute.tsx`, add:

```ts
import { SnapshotCapture } from '../../voice/SnapshotCapture';
```

Change the `useVoiceSession()` destructure:

```ts
  const { state, start, end, mute, unmute, sendSnapshot, consumeCameraOffer } = useVoiceSession();
```

Add overlay state next to `muted`:

```ts
  const [showCamera, setShowCamera] = useState(false);
```

- [ ] **Step 2: Add a camera control button (pulses when Pip offered) to the controls row**

Replace the controls row `<div className="flex shrink-0 items-center justify-between px-6 pt-[14px] pb-[18px]">…</div>` so it includes a camera button on the left. Insert this `ControlBtn` as the FIRST child of that row, before the existing Mute `ControlBtn`:

```tsx
        <ControlBtn
          label="Show Pip"
          onClick={() => { setShowCamera(true); consumeCameraOffer(); }}
          icon={
            <div className={state.cameraOffered ? 'animate-ring-pulse rounded-full' : ''}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="7" width="18" height="13" rx="3" stroke="var(--color-ink-2)" strokeWidth="2" />
                <circle cx="12" cy="13.5" r="3.5" stroke="var(--color-ink-2)" strokeWidth="2" />
                <path d="M8 7 L9.5 4.5 H14.5 L16 7" stroke="var(--color-ink-2)" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
          }
        />
```

When `state.cameraOffered` is true, also show a small hint under the title. Add this just after the header `<div className="flex items-center gap-3 px-[18px] py-3">…</div>` block:

```tsx
      {state.cameraOffered && !showCamera && (
        <div className="px-[18px] -mt-1 mb-1 text-center">
          <span className="inline-block px-3 py-[5px] rounded-full bg-coral-l text-coral-d font-body font-bold text-[12px]">
            Tap "Show Pip" to share a picture!
          </span>
        </div>
      )}
```

- [ ] **Step 3: Render the overlay**

Just before the final closing `</div>` of the main returned element (the one opened by `<div className="flex-1 flex flex-col min-h-0 overflow-hidden" ...>`), add:

```tsx
      {showCamera && (
        <SnapshotCapture
          onCapture={(b64) => { sendSnapshot(b64); setShowCamera(false); }}
          onClose={() => setShowCamera(false)}
        />
      )}
```

Note: the root element needs `relative` so the absolutely-positioned overlay anchors to it. Change the root `className` to include `relative`:

```tsx
    <div
      className="relative flex-1 flex flex-col min-h-0 overflow-hidden"
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build`
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/app/VoiceRoute.tsx
git commit -m "feat(sp7): camera button + capture overlay + Pip-offer pulse in VoiceRoute"
```

---

### Task 13: Web — repository method + image URL helper

**Files:**
- Modify: `apps/web/src/data/repository.ts`
- Modify: `apps/web/src/data/apiRepository.ts`

- [ ] **Step 1: Add to the Repository interface**

In `apps/web/src/data/repository.ts`, add `SnapshotMeta` to the shared import and a method:

```ts
import type {
  Student, Assignment, ContinueSession, Subject,
  LearningProfile, WeekActivity, RecapResult, SnapshotMeta,
} from '@study-buddy/shared';
```

```ts
  /** Recent snapshots the child showed Pip; [] when none. */
  getRecentSnapshots(): Promise<SnapshotMeta[]>;
```

- [ ] **Step 2: Implement in apiRepository + export the image URL helper**

In `apps/web/src/data/apiRepository.ts`, add `SnapshotMeta` to the import, add the method to `apiRepository`, and export a URL helper:

```ts
  getRecentSnapshots:  (): Promise<SnapshotMeta[]>        => get(`/children/${getActiveChildId()}/snapshots`),
```

```ts
/** Same-origin URL for a stored snapshot image; cookies are sent automatically by <img>. */
export function snapshotImageUrl(id: string): string {
  return `${base}/children/${getActiveChildId()}/snapshots/${id}`;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/data/repository.ts apps/web/src/data/apiRepository.ts
git commit -m "feat(sp7): repository.getRecentSnapshots + snapshotImageUrl helper"
```

---

### Task 14: Web — dashboard "What {child} showed Pip" panel

**Files:**
- Modify: `apps/web/src/routes/dashboard/DashboardRoute.tsx`

- [ ] **Step 1: Add the query + import the URL helper**

In `apps/web/src/routes/dashboard/DashboardRoute.tsx`, add to imports:

```ts
import { snapshotImageUrl } from '../../data/apiRepository';
```

Add a query alongside the others (after `assignmentsQ`):

```ts
  const snapshotsQ = useQuery({
    queryKey: ['child', childId, 'snapshots'],
    queryFn: () => repository.getRecentSnapshots(),
  });
```

- [ ] **Step 2: Render the panel**

Just before the `{/* Open app link — bottom of main */}` block near the end of `<main>`, insert:

```tsx
        {/* What the child showed Pip */}
        {snapshotsQ.data && snapshotsQ.data.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <SectionTitle>What {student.name} showed Pip</SectionTitle>
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginTop: 12 }}
            >
              {snapshotsQ.data.map((s) => (
                <a
                  key={s.id}
                  href={snapshotImageUrl(s.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-[14px] overflow-hidden border-[1.5px] border-line"
                  title={`${subjectLabel(s.subjectKind)} · ${new Date(s.createdAt).toLocaleDateString()}`}
                >
                  <img
                    src={snapshotImageUrl(s.id)}
                    alt={`${subjectLabel(s.subjectKind)} snapshot`}
                    loading="lazy"
                    style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                  />
                </a>
              ))}
            </div>
          </div>
        )}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/dashboard/DashboardRoute.tsx
git commit -m "feat(sp7): dashboard panel shows recent snapshots the child shared with Pip"
```

---

### Task 15: Pip prompt — vision/camera section (file + builtin, byte-identical)

**Files:**
- Modify: `apps/server/study-buddy.md`
- Modify: `apps/server/src/voice/systemPrompt.ts`
- Verify: `apps/server/test/voice/systemPrompt.test.ts` (the existing drift-guard)

- [ ] **Step 1: Add the same section to BOTH files**

The exact text block to insert (identical in both places). In `apps/server/study-buddy.md`, insert it **immediately before** the `## Learning-signal tool (do not mention to the child)` section:

```markdown
## Showing you their work (camera)
{{childName}} can show you a picture of their work — a drawing, a worksheet, a book page, or real objects they are counting. When seeing a picture would help, warmly invite them by calling the offer_camera tool, then say something like "Can you hold it up so I can see?" You cannot take the picture yourself — {{childName}} taps the camera button. When a picture arrives, describe what you notice and ask {{childName}} about it.

The Socratic rule still applies to pictures: if a picture shows the answer (for example a worksheet with the answer printed, or a finished sum), do NOT read the answer out. Guide {{childName}} to it with questions, exactly as you would without the picture.

```

In `apps/server/src/voice/systemPrompt.ts`, insert the **identical** lines into the `BUILTIN_TEMPLATE` string at the same position (immediately before `## Learning-signal tool (do not mention to the child)`), so the two stay byte-identical. The relevant region becomes:

```ts
## Staying on track
If {{childName}} goes off-topic or seems upset, gently steer back. Do not lecture.

## Showing you their work (camera)
{{childName}} can show you a picture of their work — a drawing, a worksheet, a book page, or real objects they are counting. When seeing a picture would help, warmly invite them by calling the offer_camera tool, then say something like "Can you hold it up so I can see?" You cannot take the picture yourself — {{childName}} taps the camera button. When a picture arrives, describe what you notice and ask {{childName}} about it.

The Socratic rule still applies to pictures: if a picture shows the answer (for example a worksheet with the answer printed, or a finished sum), do NOT read the answer out. Guide {{childName}} to it with questions, exactly as you would without the picture.

## Learning-signal tool (do not mention to the child)
```

- [ ] **Step 2: Run the drift-guard test to confirm the file and builtin match exactly**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/systemPrompt.test.ts`
Expected: PASS. If it FAILS with a mismatch, the two insertions differ (whitespace/punctuation) — diff them and make them byte-identical.

- [ ] **Step 3: Commit**

```bash
git add apps/server/study-buddy.md apps/server/src/voice/systemPrompt.ts
git commit -m "feat(sp7): teach Pip to invite the camera (offer_camera) + Socratic-on-vision rule"
```

---

### Task 16: Update the spec to match the child-scoped read surface

**Files:**
- Modify: `docs/superpowers/specs/2026-06-02-study-buddy-camera-vision-design.md`

- [ ] **Step 1: Reconcile §5 (Routes) and §8 (dashboard) with the implemented design**

In the spec, replace the per-session read endpoints in the **Routes** subsection with the child-scoped pair actually built:

```markdown
### Routes — `apps/server/src/routes/`
Two **child-scoped** endpoints, both behind the existing `childContext`
guardian-ownership authz (unowned child → 404, no session → 401):
- `GET /api/children/:childId/snapshots` → JSON `SnapshotMeta[]`
  (`{ id, sessionId, subjectKind, createdAt }`, newest first, limit 24).
- `GET /api/children/:childId/snapshots/:snapshotId` → image bytes with
  `Content-Type: image/jpeg` (a plain `<img src>` target).

> The dashboard has no session-detail/history surface yet (SP6 deferred it), so
> v1 ships a flat "What {child} showed Pip" panel fed by the list endpoint rather
> than a per-session strip. Per-session grouping is a later add.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-02-study-buddy-camera-vision-design.md
git commit -m "docs(sp7): spec read endpoints are child-scoped (no session-detail view yet)"
```

---

### Task 17: Manual smoke doc

**Files:**
- Create: `docs/superpowers/SP7-manual-smoke.md`

- [ ] **Step 1: Write the smoke checklist**

Create `docs/superpowers/SP7-manual-smoke.md`:

```markdown
# SP7 — Camera Vision ("Show Pip") manual smoke

Camera capture needs a real device + a human mic session; this is not in CI.
Run on Chrome (the verified browser). Dev seed login: `parent@studybuddy.dev` /
`studybuddy`, dashboard PIN `1234`.

## Setup
- Stack up: `docker compose up -d` (server, web, postgres healthy).
- Open `/app`, sign in, pick a child, start a voice session, let it go live.

## Happy path
1. Tap **Show Pip** → camera opens (rear/environment camera).
2. Point at a worksheet/drawing, tap the shutter → freeze-frame preview.
3. Tap **Send to Pip** (or **Retake** first). Pip reacts in audio to what it saw.
4. Verify a `session_snapshots` row exists:
   `docker compose exec -T postgres psql -U studybuddy -d studybuddy -c "select left(id::text,8) id, left(session_id::text,8) sess, mime, octet_length(image) bytes, created_at from session_snapshots order by created_at desc limit 5;"`

## Socratic-on-vision (the key check)
5. Show Pip a problem whose **answer is visible** (e.g. a worksheet with "7×8=56"
   printed). Confirm Pip does **not** read the answer out — it guides instead.

## Pip-invited camera
6. Get into a spot where a picture would help (mention a drawing, or get stuck on
   something spatial). Confirm Pip invites you and the **Show Pip** button pulses
   with the "Tap to show Pip!" hint. Tapping it clears the hint.

## Preview / retake / permission
7. Capture → **Retake** → recapture works.
8. Deny camera permission once → friendly message, **session keeps going** (audio
   unaffected).

## Dashboard viewer + authz
9. Open `/dashboard` for that child → "What {child} showed Pip" shows the thumbnail(s).
10. Click a thumbnail → full image opens.
11. (Authz) As a different guardian / child, the snapshot list does not include
    these, and a direct `/api/children/<otherChild>/snapshots/<id>` returns 404.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/SP7-manual-smoke.md
git commit -m "docs(sp7): manual smoke checklist"
```

---

### Task 18: Full verification + docs update

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Run the full server test suite**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`
Expected: all pass. (If the known `assignments/today` + `activity?range=week` pollution flake appears from repeated runs, reset with `DROP DATABASE studybuddy_test` and re-run — unrelated to SP7.)

- [ ] **Step 2: Server typecheck + web typecheck + web build + web unit tests**

Run:
```bash
cd apps/server && bun run typecheck
cd ../.. && pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build
cd apps/web && bun test
```
Expected: all PASS.

- [ ] **Step 3: Apply the migration to the running stack (manual confirm)**

Run:
```bash
export PATH="/usr/local/bin:$PATH"
docker compose exec -T server sh -c 'cd /app/apps/server && bun run db:migrate'
docker compose exec -T postgres psql -U studybuddy -d studybuddy -c "\d session_snapshots"
```
Expected: the `db:migrate` applies `0004_*`; `\d session_snapshots` shows the table with an `image | bytea` column.

- [ ] **Step 4: Update status docs**

In `CLAUDE.md`, add SP7 to the status block and roadmap (camera vision: snapshot-on-demand over the voice WS → `sendRealtimeInput({video})`, `session_snapshots` bytea, `offer_camera` tool, dashboard viewer; pending human mic smoke). In `docs/HANDOFF.md`, add an SP7 "What's done" bullet and point "Suggested next steps" at `SP7-manual-smoke.md`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/HANDOFF.md
git commit -m "docs(sp7): record camera-vision subsystem status (pending mic smoke)"
```

---

## Self-review notes (author)

- **Spec coverage:** transport (Approach A) → Tasks 1,5,6,12; snapshot model + preview/confirm → Task 11; single JPEG 1024/q0.85 → Task 8; bytea storage → Tasks 2,3; `offer_camera` → Tasks 4,5,6,12,15; always-visible button + pulse → Task 12; guardian-only read authz → Tasks 3,7; dashboard viewer → Tasks 13,14; Socratic-on-vision → Task 15; error handling (bad mime/size, storage failure best-effort, permission-denied continues) → Tasks 6,11; testing → Tasks 3,4,6,7,8,9 + manual Task 17. Parent-dashboard-only / no child-recap thumbnails honored (no recap changes).
- **Deviation:** read endpoints are child-scoped (not per-session) because no session-detail surface exists; documented in the header, Task 16 updates the spec.
- **Type consistency:** `sendImage(jpegBase64)` (Tasks 5/6), `saveSnapshot(sessionId, childId, Buffer, mime)` (Tasks 3/6), `SnapshotMeta {id,sessionId,subjectKind,createdAt}` (Tasks 1/3/13/14), control messages `snapshot`/`snapshot-ack`/`camera-offered` (Tasks 1/6/9/10/12) all align.
```
