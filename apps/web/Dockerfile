FROM oven/bun:1.1-alpine AS base
WORKDIR /app
RUN apk add --no-cache nodejs npm \
 && npm install -g pnpm@9

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["pnpm", "--filter", "@study-buddy/web", "dev", "--host", "0.0.0.0"]

FROM deps AS build
COPY . .
RUN pnpm --filter @study-buddy/web build

FROM nginx:alpine AS prod
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
