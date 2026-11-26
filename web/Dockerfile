# The web app as a container, for AWS ECS Express Mode (docs/AWS.md).
# Build from the repo root, not web/: `next build` type-checks scripts that
# import from platform/, as CI does.
#
#   docker build -f web/Dockerfile -t sectionary-web .
#   docker run -p 8080:8080 --env-file web/.env.local sectionary-web
#
# NEXT_PUBLIC_* values are baked into the browser code at build time, so they
# are build arguments here; every other setting is read when the server runs.

FROM node:24-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY . .

ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_BLOCKS_SRC
ARG NEXT_PUBLIC_STORES_SRC
ARG NEXT_PUBLIC_SITES_SRC
ARG NEXT_PUBLIC_ASSET_BASE
ARG NEXT_PUBLIC_CONTACT_EMAIL
ARG NEXT_PUBLIC_AUTH_GOOGLE
# An argument left out arrives as an empty string, which is not the same as
# unset (NEXT_PUBLIC_BLOCKS_SRC="" would point the wall at nothing); empty ones are dropped.
RUN cd web \
  && for v in $(env | grep '^NEXT_PUBLIC_[A-Z_]*=$' | cut -d= -f1); do unset "$v"; done \
  && npm run build

FROM node:24-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/web/.next/static ./.next/static
COPY --from=build --chown=node:node /repo/web/public ./public
USER node
EXPOSE 8080
# HOSTNAME is set again when the server starts, not only above: on ECS Fargate
# the runtime replaces it with the task's own name (ip-172-31-...internal), and
# the Next.js server listens on HOSTNAME. It then answered only on the task's
# private address, so the cache warm-up's requests to 127.0.0.1
# (src/instrumentation.ts) were refused on every start since 17 Nov 2026
# ("cache warm: 0 block types in 30s").
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]
