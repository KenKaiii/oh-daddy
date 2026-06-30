#!/usr/bin/env bash
#
# Production start command (wired via railway.json -> deploy.startCommand, so it
# runs on EVERY deploy: GitHub auto-deploy AND `railway up`).
#
# Backgrounds a one-shot Inngest re-sync (scripts/post-deploy-sync.mjs): it
# waits for THIS new container to start serving, then PUTs /api/inngest so the
# self-hosted Inngest engine picks up function changes (added/removed/retuned
# functions). Without this, self-hosted Inngest keeps the previous deploy's
# registration and new functions silently never run. The sync never blocks or
# fails startup.
#
# `exec`s the real server last so it owns PID 1 (clean SIGTERM handling for
# Railway's zero-downtime shutdown).
set -euo pipefail

node scripts/post-deploy-sync.mjs &

exec npm run start
