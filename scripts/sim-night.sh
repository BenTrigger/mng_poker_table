#!/usr/bin/env bash
# Game-night simulation: six users on six phones play a whole night against a
# LOCAL Supabase (never production). Needs Docker and the Supabase CLI.
#   npm run test:sim            start the local stack if needed, build, run
#   SKIP_BUILD=1 npm run test:sim   reuse the last build
set -euo pipefail
cd "$(dirname "$0")/.."
SUPABASE="${SUPABASE_CLI:-npx --yes supabase}"

if ! $SUPABASE status >/dev/null 2>&1; then
  $SUPABASE start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta
fi
eval "$($SUPABASE status -o env)"
case "$API_URL" in http://127.0.0.1*|http://localhost*) ;; *) echo "refusing: $API_URL is not local"; exit 1 ;; esac

export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
# chip counting is mocked in the browser; the real API must never be called
unset ANTHROPIC_API_KEY

[ "${SKIP_BUILD:-}" = 1 ] || npx next build
npx playwright test -c playwright.sim.config.ts "$@"
