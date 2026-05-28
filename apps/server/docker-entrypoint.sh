#!/bin/sh
set -e
echo "[entrypoint] running migrations…"
cd /app/apps/server && bun run drizzle-kit migrate
echo "[entrypoint] running seed (idempotent)…"
bun run src/db/seed.ts
echo "[entrypoint] starting server…"
exec "$@"
