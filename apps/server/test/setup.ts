import postgres from 'postgres';

const PG_HOST = process.env.PG_TEST_HOST ?? 'localhost';
const PG_PORT = process.env.PG_TEST_PORT ?? '5432';

const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ??
  `postgres://studybuddy:studybuddy@${PG_HOST}:${PG_PORT}/postgres`;
const TEST_DB_URL =
  process.env.DATABASE_URL ??
  `postgres://studybuddy:studybuddy@${PG_HOST}:${PG_PORT}/studybuddy_test`;

export async function ensureTestDb(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    const existing = await admin`
      SELECT 1 FROM pg_database WHERE datname = 'studybuddy_test'
    `;
    if (existing.length === 0) {
      await admin.unsafe('CREATE DATABASE studybuddy_test');
    }
  } finally {
    await admin.end();
  }
}

export function setDatabaseUrl(): void {
  process.env.DATABASE_URL = TEST_DB_URL;
}

export const TEST_DATABASE_URL = TEST_DB_URL;
