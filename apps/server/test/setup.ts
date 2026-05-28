import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { count } from 'drizzle-orm';
import { children } from '../src/db/schema';

const PG_HOST = process.env.PG_TEST_HOST ?? 'localhost';
const PG_PORT = process.env.PG_TEST_PORT ?? '5432';

const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ??
  `postgres://studybuddy:studybuddy@${PG_HOST}:${PG_PORT}/postgres`;
export const TEST_DATABASE_URL =
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
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

export async function migrateAndSeedTestDb(): Promise<void> {
  const sql = postgres(TEST_DATABASE_URL, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: './drizzle' });
  const [{ count: existing }] = await db.select({ count: count() }).from(children);
  await sql.end();
  if (existing === 0) {
    const { seedMain } = await import('../src/db/seed');
    await seedMain();
  }
}
