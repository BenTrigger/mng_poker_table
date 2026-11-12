import { expect, test, type Page } from "@playwright/test";

/** Fails the test on any uncaught page error or console error. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // network calls to the (fake, in CI) Supabase project are expected to fail
    if (/supabase|Failed to load resource|ERR_|net::/i.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(1);
}

test("landing page offers Google sign-in and legal links", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: /כניסה עם Google/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "מדיניות פרטיות" })).toHaveAttribute("href", "/privacy");
  await expect(page.getByRole("link", { name: "תנאי שימוש" })).toHaveAttribute("href", "/terms");
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("sign-in button goes to Google through Supabase", async ({ page }) => {
  test.skip(!process.env.BASE_URL, "needs the real Supabase project (run with BASE_URL)");
  await page.goto("/");
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/auth/v1/authorize")),
    page.getByRole("button", { name: /כניסה עם Google/ }).click(),
  ]);
  const url = new URL(req.url());
  expect(url.searchParams.get("provider")).toBe("google");
  expect(url.searchParams.get("redirect_to")).toContain("/auth/callback");
  await page.waitForURL(/accounts\.google\.com/, { timeout: 15_000 });
});

for (const [path, heading] of [
  ["/privacy", "מדיניות פרטיות"],
  ["/terms", "תנאי שימוש"],
] as const) {
  test(`${path} is public and readable`, async ({ page }) => {
    const errors = watchErrors(page);
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText("benlerer87@gmail.com").first()).toBeVisible();
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test("install page explains how to install the app", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/install");
  await expect(page.getByRole("heading", { name: "All In" })).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("app is installable: manifest, icons and service worker are served", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  const m = await manifest.json();
  expect(m.dir).toBe("rtl");
  expect(m.display).toBe("standalone");
  for (const icon of m.icons as { src: string }[]) {
    expect((await request.get(icon.src)).ok(), icon.src).toBeTruthy();
  }
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBeTruthy();
  expect(await sw.text()).toContain("addEventListener");
});

test("version endpoint reports the running version", async ({ request }) => {
  const res = await request.get("/api/version");
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["cache-control"]).toContain("no-store");
  const v = await res.json();
  expect(v.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(v.build).toBeTruthy();
});

test("chip counting API refuses signed-out callers", async ({ request }) => {
  const res = await request.post("/api/count-chips", { data: {} });
  // 401 when chip counting is configured, 501 when no API key is set
  expect([401, 501]).toContain(res.status());
});

for (const path of ["/tables", "/t/ABC123", "/join/ABC123", "/s/00000000-0000-0000-0000-000000000000"]) {
  test(`${path} sends signed-out visitors to sign in`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page.getByRole("button", { name: /כניסה עם Google/ })).toBeVisible({ timeout: 15_000 });
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test("unknown page shows 404", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
});

test("push endpoints are safe without setup or sign-in", async ({ request }) => {
  test.skip(!!process.env.BASE_URL, "local build only");
  const key = await request.get("/api/push/key");
  expect(key.ok()).toBeTruthy();
  expect(await key.json()).toHaveProperty("key");
  const t = await request.post("/api/push/test");
  expect(t.status()).toBe(401); // never sends for a signed-out caller
});

test("service worker handles push and notification taps", async ({ request }) => {
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBeTruthy();
  const src = await sw.text();
  expect(src).toContain('addEventListener("push"');
  expect(src).toContain('addEventListener("notificationclick"');
});
