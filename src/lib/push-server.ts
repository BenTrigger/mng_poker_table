// Server-only: sends Web Push messages for rows in public.notifications.
import pg from "pg";
import * as webpush from "web-push";

let pool: pg.Pool | null = null;
function db() {
  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
  if (!url) throw new Error("no database connection string");
  if (!pool) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    pool = new pg.Pool({
      connectionString: url.replace(/[?&]sslmode=[^&]*/g, ""),
      ssl: local ? false : { rejectUnauthorized: false },
      max: 2,
    });
  }
  return pool;
}

async function config(key: string) {
  const { rows } = await db().query<{ value: string }>("select value from app_meta.config where key = $1", [key]);
  return rows[0]?.value ?? null;
}

type Vapid = { publicKey: string; privateKey: string };
let vapidCache: Promise<Vapid> | null = null;

/**
 * The VAPID key pair. Env vars win if set; otherwise it lives in
 * app_meta.config (made on first use, so there is nothing to set up by hand).
 */
export function vapidKeys(): Promise<Vapid> {
  vapidCache ??= (async () => {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    }
    let pub = await config("vapid_public_key");
    let priv = await config("vapid_private_key");
    if (!pub || !priv) {
      const k = webpush.generateVAPIDKeys();
      // two first calls at once: only one pair wins, both read it back
      await db().query(
        `insert into app_meta.config (key, value) values ('vapid_public_key', $1), ('vapid_private_key', $2)
         on conflict (key) do nothing`,
        [k.publicKey, k.privateKey],
      );
      pub = await config("vapid_public_key");
      priv = await config("vapid_private_key");
    }
    if (!pub || !priv) throw new Error("no VAPID keys");
    return { publicKey: pub, privateKey: priv };
  })().catch((e) => {
    vapidCache = null;
    throw e;
  });
  return vapidCache;
}

export async function dispatchSecret() {
  return config("push_dispatch_secret");
}

let vapidSet = false;
async function vapid() {
  if (vapidSet) return;
  const k = await vapidKeys();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://pokertable.realizeaisolutions.com", k.publicKey, k.privateKey);
  vapidSet = true;
}

export type PushMessage = { title: string; body: string; url: string | null; tag?: string; id?: number };

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

// Calls that start the game get delivered right away even on a sleeping phone.
const URGENT = new Set(["night_started", "tournament_started", "seat_freed", "tournament_seat", "chip_request"]);

async function sendTo(subs: Sub[], msg: PushMessage, urgent: boolean) {
  await vapid();
  const dead: string[] = [];
  const ok: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(msg),
          { TTL: 12 * 3600, urgency: urgent ? "high" : "normal", timeout: 8000 },
        );
        ok.push(s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // the browser dropped this subscription
        else console.error("[push] send failed", code, (e as Error).message);
      }
    }),
  );
  const c = db();
  if (dead.length) await c.query("delete from public.push_subscriptions where id = any($1::uuid[])", [dead]);
  if (ok.length) await c.query("update public.push_subscriptions set last_ok_at = now() where id = any($1::uuid[])", [ok]);
  return { sent: ok.length, removed: dead.length };
}

// Claims every notification not pushed yet and sends it. Safe to call any
// number of times at once: each row is claimed by exactly one caller.
export async function dispatchPending() {
  const c = db();
  // anything older than 15 minutes is stale news: show it in the app only
  await c.query(
    "update public.notifications set pushed_at = now() where pushed_at is null and created_at < now() - interval '15 minutes'",
  );
  const { rows } = await c.query<{ id: number; user_id: string; kind: string; title: string; body: string; url: string | null }>(
    `update public.notifications n set pushed_at = now()
      where n.id in (select id from public.notifications where pushed_at is null order by id limit 300 for update skip locked)
      returning n.id, n.user_id, n.kind, n.title, n.body, n.url`,
  );
  if (!rows.length) return { notifications: 0, sent: 0, removed: 0 };
  const users = [...new Set(rows.map((r) => r.user_id))];
  const { rows: subs } = await c.query<Sub>(
    "select id, user_id, endpoint, p256dh, auth from public.push_subscriptions where user_id = any($1::uuid[])",
    [users],
  );
  let sent = 0;
  let removed = 0;
  for (const n of rows) {
    const mine = subs.filter((s) => s.user_id === n.user_id);
    if (!mine.length) continue;
    const r = await sendTo(mine, { id: n.id, title: n.title, body: n.body, url: n.url, tag: `n${n.id}` }, URGENT.has(n.kind));
    sent += r.sent;
    removed += r.removed;
  }
  return { notifications: rows.length, sent, removed };
}

// A test message to the signed-in user's own devices only.
export async function sendTest(userId: string) {
  const { rows } = await db().query<Sub>(
    "select id, user_id, endpoint, p256dh, auth from public.push_subscriptions where user_id = $1",
    [userId],
  );
  if (!rows.length) return { sent: 0, removed: 0, devices: 0 };
  const r = await sendTo(rows, { title: "בדיקת התראות ♠️", body: "מעולה, ההתראות עובדות במכשיר הזה", url: "/notifications", tag: "test" }, true);
  return { ...r, devices: rows.length };
}
