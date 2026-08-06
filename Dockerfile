# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# Cache mount so a lockfile change re-resolves from a warm npm cache instead of
# re-downloading every package. The layer cache already covers the no-change
# case; this covers the change case.
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars are baked into the client bundle at BUILD time, not read
# at container runtime — must arrive as build ARGs, not just env_file.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
# Node's default heap ceiling is too conservative for this build (hit an OOM
# around ~2GB on the WSL2 host, which has ~7.7GB free and barely any of it
# used by Steel) — raise it explicitly rather than touching WSL2's own
# memory config.
ENV NODE_OPTIONS=--max-old-space-size=5120
# `next build` is the entire cost of a deploy - measured at 144s of a ~240s
# run, with every other step either cached or under a second. Next writes its
# incremental compilation cache to .next/cache, which a container build
# normally discards, so every deploy was a cold full compile.
#
# A BuildKit cache mount persists that directory on the builder between builds
# without putting it in the image. Deploys that touch a handful of files now
# recompile only those. A cold cache (first run, or after `docker builder
# prune`) still costs the full 144s.
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:24-alpine AS runner
WORKDIR /app
# Stamped so the running container can say which commit it was built from.
# Without it there is no way to tell "the deploy did not happen" from "the code
# does not do what you think" - the failure looks identical in the browser.
ARG GIT_SHA=unknown
ENV NODE_ENV=production PORT=3417 GIT_SHA=$GIT_SHA
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3417
CMD ["node", "server.js"]
