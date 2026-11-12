#!/usr/bin/env node
// Applies pending supabase/migrations/*.sql to the production database.
// Runs before `next build` on Vercel production deploys, so a release and the
// database changes it needs go live together. If a migration fails the build
// fails, and the previous release keeps serving.
//
// Connection: POSTGRES_URL_NON_POOLING (set by the Supabase <-> Vercel
// integration), or SUPABASE_DB_URL / DATABASE_URL.
// Skips on Vercel preview builds, and when no connection string is set.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// Every migration up to this version was applied by hand before this runner
// existed. On the first run they are recorded as applied, not run again.
const BASELINE = "20261112150000";
const DIR = join(process.cwd(), "supabase", "migrations");

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const onVercel = !!process.env.VERCEL;
const log = (m) => console.log(`[migrate] ${m}`);

if (onVercel && process.env.VERCEL_ENV !== "production") {
  log(`skipped (${process.env.VERCEL_ENV} build)`);
  process.exit(0);
}
if (!url) {
  log("skipped (no database connection string set)");
  process.exit(0);
}

const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const versions = files.map((f) => f.slice(0, 14));
const dup = versions.find((v, i) => versions.indexOf(v) !== i);
if (dup) {
  console.error(`[migrate] two migrations share version ${dup}`);
  process.exit(1);
}

const local = /@(localhost|127\.0\.0\.1)[:/]|host=\/|^postgres:\/\/\/?[^@]*$/.test(url);
const client = new pg.Client({
  connectionString: (() => {
    try {
      const u = new URL(url);
      u.searchParams.delete("sslmode");
      return u.toString();
    } catch {
      return url;
    }
  })(),
  ssl: local ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("select pg_advisory_lock(727274)"); // one deploy at a time
  await client.query(`
    create schema if not exists app_meta;
    revoke all on schema app_meta from public;
    create table if not exists app_meta.migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );`);

  const { rows } = await client.query("select version from app_meta.migrations");
  const done = new Set(rows.map((r) => r.version));

  // Baseline only a database that already has the schema (set up by hand);
  // a brand-new database gets every migration.
  const { rows: existing } = await client.query("select to_regclass('public.poker_tables') is not null as has_schema");
  if (done.size === 0 && existing[0].has_schema) {
    const base = files.filter((f) => f.slice(0, 14) <= BASELINE);
    for (const f of base) {
      await client.query("insert into app_meta.migrations (version, name) values ($1, $2)", [f.slice(0, 14), `${f} (baseline)`]);
      done.add(f.slice(0, 14));
    }
    log(`baseline: recorded ${base.length} migrations that were already applied`);
  }

  const pending = files.filter((f) => !done.has(f.slice(0, 14)));
  if (!pending.length) log("database is up to date");
  for (const f of pending) {
    const sql = readFileSync(join(DIR, f), "utf8");
    log(`applying ${f}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into app_meta.migrations (version, name) values ($1, $2)", [f.slice(0, 14), f]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw new Error(`${f}: ${e.message}`);
    }
  }
  if (pending.length) log(`applied ${pending.length} migration(s)`);

  // Where the database pings the app to send phone push (see the
  // notifications migration). Production builds only, never local/CI runs.
  const prodHost = onVercel && process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const dispatchUrl = process.env.PUSH_DISPATCH_URL || (prodHost ? `https://${prodHost}/api/push/dispatch` : null);
  const { rows: cfg } = await client.query("select to_regclass('app_meta.config') is not null as ok");
  if (dispatchUrl && cfg[0].ok) {
    await client.query(
      `insert into app_meta.config (key, value) values ('push_dispatch_url', $1)
       on conflict (key) do update set value = excluded.value`,
      [dispatchUrl],
    );
    log(`push dispatch -> ${dispatchUrl}`);
  }
} catch (e) {
  console.error(`[migrate] FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
