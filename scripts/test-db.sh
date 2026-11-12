#!/usr/bin/env bash
# Database tests: builds a fresh database from every migration (on top of a
# small Supabase shim) and runs supabase/tests/*.test.sql against it as real
# app users, with RLS on.
#
# Needs a Postgres 15+ server. Connection comes from the usual PG* env vars,
# e.g. PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres.
# VERBOSE=1 lists every check.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="poker_test_$$"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
cleanup() { "${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${PSQL[@]}" -d postgres -c "create database $DB" >/dev/null
export PGOPTIONS="--client-min-messages=error"
"${PSQL[@]}" -d "$DB" -f supabase/tests/00_supabase_shim.sql >/dev/null
for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null || { echo "✗ migration failed: $f"; exit 1; }
done
echo "✓ all migrations apply on a fresh database"
"${PSQL[@]}" -d "$DB" -f supabase/tests/01_helpers.sql >/dev/null

fail=0
for t in supabase/tests/*.test.sql; do
  status=0
  out=$(PGOPTIONS="--client-min-messages=notice" "${PSQL[@]}" -d "$DB" -f "$t" 2>&1) || status=$?
  passed=$(grep -c "NOTICE:  ok - " <<<"$out" || true)
  if [ "$status" -eq 0 ]; then
    echo "✓ $(basename "$t"): $passed checks passed"
  else
    fail=1
    echo "✗ $(basename "$t") failed after $passed passing checks:"
    grep -E "ERROR|FAIL" <<<"$out" | head -5 | sed 's/^/    /'
  fi
  if [ "${VERBOSE:-}" = 1 ]; then grep "NOTICE:  ok - " <<<"$out" | sed 's/.*NOTICE:  ok - /    · /'; fi
done
exit $fail
