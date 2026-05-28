FROM oven/bun:1.1-alpine AS base
WORKDIR /app
RUN apk add --no-cache nodejs npm \
 && npm install -g pnpm@9

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
ENTRYPOINT ["/app/apps/server/docker-entrypoint.sh"]
CMD ["bun", "--watch", "src/index.ts"]

FROM deps AS build
COPY . .
RUN pnpm --filter @study-buddy/shared build || true
RUN pnpm --filter @study-buddy/server typecheck

FROM base AS prod
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/server /app/apps/server
COPY --from=build /app/packages/shared /app/packages/shared
WORKDIR /app
EXPOSE 3001
ENTRYPOINT ["/app/apps/server/docker-entrypoint.sh"]
CMD ["bun", "src/index.ts"]
