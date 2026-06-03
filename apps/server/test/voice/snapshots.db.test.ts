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
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]);
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
