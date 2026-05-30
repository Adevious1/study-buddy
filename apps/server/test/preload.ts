/** Bun test preload: set DATABASE_URL before any module is evaluated. */
const host = process.env.PG_TEST_HOST ?? 'localhost';
const port = process.env.PG_TEST_PORT ?? '5432';
process.env.DATABASE_URL = `postgres://studybuddy:studybuddy@${host}:${port}/studybuddy_test`;
