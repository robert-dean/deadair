# syntax=docker/dockerfile:1
#
# Single image that runs the Koa API and serves the built React SPA from the same
# origin. The API mounts its routers under `/api` and falls back to the SPA's
# index.html for every other GET (see apps/api/src/server/middleware/spa.middleware.ts).
#
# The API is executed through @swc-node/register (the same way `pnpm dev` runs it),
# which transpiles the TypeScript source on the fly and honours the package.json
# `#src/*` subpath imports — avoiding a separate tsc/dist alias-rewrite step.

# ── Builder: install deps, build the SDK + SPA ──────────────────────────────────
FROM node:26-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile
# Build the SDK (the SPA imports its dist) then the SPA bundle.
RUN pnpm --filter @deadair/sdk build \
    && pnpm --filter @app/web build \
    && mkdir -p apps/api/public/spa \
    && cp -r apps/web/dist/. apps/api/public/spa/

# ── Runtime ─────────────────────────────────────────────────────────────────────
FROM node:26-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Carry over the installed workspace (pnpm's node_modules symlinks are relative,
# so copying the whole tree preserves them) plus the staged SPA build.
COPY --from=builder /app /app

# Where spa.middleware.ts looks for the built SPA.
ENV WEB_DIST_DIR=/app/apps/api/public/spa
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/apps/api
# Runtime config (DATABASE_*, REDIS_*, KMS/JWT secrets, APP_BASE_URL, …) is supplied
# via the environment / an env file at `docker run` time — see docker-compose.yml.
CMD ["node", "--no-warnings", "--no-deprecation", "--import", "@swc-node/register/esm-register", "./src/index.ts"]
