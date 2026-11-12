// Helpers for the game-night simulation: real users on a local Supabase
// (`supabase start`), each in their own browser, with chip recognition mocked.
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { devices } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const simConfigured = /127\.0\.0\.1|localhost/.test(SB_URL) && !!ANON && !!SERVICE;

/** Service-role client, for creating users and checking the database. Local stack only. */
export function db(): SupabaseClient {
  if (!simConfigured) throw new Error("the simulation only runs against a local Supabase (supabase start)");
  return createClient(SB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ---------------------------------------------------------------------------
// Chip recognition mock. Each photo the app sends to /api/count-chips takes the
// next total from the queue, so a test decides what "the camera saw".
// ---------------------------------------------------------------------------
export class Vision {
  private queue: number[] = [];
  calls = 0;
  /** The next photo will be recognised as this many chips. */
  sees(total: number) {
    this.queue.push(total);
  }
  next(): number {
    const t = this.queue.shift();
    if (t == null) throw new Error("a photo was counted but the test did not say what the camera sees");
    this.calls++;
    return t;
  }
  get pending() {
    return this.queue.length;
  }
}

type Chip = { color: string; value: number };
function compose(total: number, chips: Chip[]) {
  const sorted = [...chips].sort((a, b) => b.value - a.value);
  let left = total;
  const counts = sorted.map((c) => {
    const n = Math.floor(left / c.value);
    left -= n * c.value;
    return { color: c.color, count: n };
  });
  return chips.map((c) => counts.find((x) => x.color === c.color)!);
}

export type Player = {
  name: string;
  email: string;
  userId: string;
  ctx: BrowserContext;
  page: Page;
  errors: string[];
  /** The same user straight against the API, to try what the UI does not offer. */
  api: SupabaseClient;
};

const runId = Date.now().toString(36);
// scenarios run in one process and reuse names, so every user gets their own number
let userNo = 0;
const PASSWORD = "sim-password-123";

/** A signed-in user with their own phone (browser context). */
export async function newPlayer(browser: Browser, baseURL: string, vision: Vision, name: string): Promise<Player> {
  const email = `${encodeURIComponent(name).replace(/%/g, "").toLowerCase().slice(0, 20)}-${runId}-${++userNo}@sim.test`;
  const { data, error } = await db().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw error;

  // sign in exactly like the app does (@supabase/ssr cookies), then hand the cookies to the browser
  const jar = new Map<string, string>();
  const sb = createServerClient(SB_URL, ANON, {
    cookies: {
      getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
      setAll: (list) => list.forEach((c) => jar.set(c.name, c.value)),
    },
  });
  const { error: signInError } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;

  const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL, locale: "he-IL" });
  await ctx.addCookies([...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await ctx.route("**/api/count-chips", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
    const body = route.request().postDataJSON() as { chips: Chip[] };
    const total = vision.next();
    return route.fulfill({
      json: { counts: compose(total, body.chips), total, confidence: "high", notes: "" },
    });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("dialog", (d) => d.accept()); // "are you sure?" confirms
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  if (process.env.CI) page.on("console", (m) => console.log(`[${name}] ${m.type()}: ${m.text().slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|websocket|ERR_ABORTED|navigator.vibrate/i.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  const api = createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: apiError } = await api.auth.signInWithPassword({ email, password: PASSWORD });
  if (apiError) throw apiError;
  return { name, email, userId: data.user.id, ctx, page, errors, api };
}

let photo: Buffer | null = null;
/** Any real JPEG works: recognition is mocked, the app still compresses and uploads it. */
export async function stackPhoto(page: Page) {
  if (!photo) photo = await page.screenshot({ type: "jpeg", quality: 60 });
  return { name: "stack.jpg", mimeType: "image/jpeg", buffer: photo };
}

/** The open bottom sheet (sheets render into <body>). */
export function sheet(page: Page) {
  return page.locator("div.sheet-up").last();
}

/** Take a photo in the chip counter of the open sheet and wait for the recognised count. */
export async function photograph(page: Page, expectedTotal: number) {
  const s = sheet(page);
  await s.locator('input[type="file"]').setInputFiles(await stackPhoto(page));
  await expect(s.getByText("זיהיתי בתמונה")).toBeVisible();
  await expect(s.getByLabel("סה״כ צ'יפים")).toHaveValue(String(expectedTotal));
}

export const btn = (scope: Page | ReturnType<typeof sheet>, name: string | RegExp) =>
  scope.getByRole("button", { name, exact: typeof name === "string" ? false : undefined });

/**
 * A fresh local stack (as in CI) can take a while before realtime delivers its
 * first database change. Wait until it does, so the scenario measures the app
 * and not the stack warming up.
 */
export async function warmRealtime(timeoutMs = 120_000) {
  const email = `warmup-${runId}@sim.test`;
  await db().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "warmup" } });
  const sb = createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  const { data: table, error: e2 } = await sb.rpc("create_table", { p_name: "warmup" });
  if (e2) throw e2;
  const started = Date.now();
  let got = false;
  const statuses: string[] = [];
  const ch = sb
    .channel(`warmup-${runId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "table_members", filter: `table_id=eq.${table.id}` }, () => {
      got = true;
    })
    .subscribe((status, err) => statuses.push(`${status}${err ? `: ${err.message}` : ""} @${Date.now() - started}ms`));
  try {
    while (!got) {
      if (Date.now() - started > timeoutMs) throw new Error(`realtime never delivered a change (${statuses.join(", ")})`);
      await db().from("table_members").insert({ table_id: table.id, display_name: "ping" });
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(`realtime ready after ${Date.now() - started}ms (${statuses.join(", ")})`);
  } finally {
    await sb.removeChannel(ch);
  }
}
