// A tournament on two tables: registration from the link with a waiting list,
// a drop-out, the seat draw, bust-outs, table balancing, a rebuy and an add-on,
// the final, prizes that add up to the pool, and who pays whom.
import { expect, test, type Page } from "@playwright/test";
import { btn, db, newPlayer, sheet, simConfigured, Vision, warmRealtime, type Player } from "./sim";

test.skip(!simConfigured, "needs a local Supabase (supabase start), see e2e-sim/README.md");

const NAMES = ["אורי", "בר", "גיא", "דנה", "הילה", "ורד", "זיו"];

test("a two-table tournament from registration to payouts", async ({ browser, baseURL }) => {
  test.setTimeout(6 * 60_000);
  await warmRealtime();
  const vision = new Vision();
  const tal = await newPlayer(browser, baseURL!, vision, "טל"); // admin, runs the tournament without playing
  const players: Player[] = [];
  for (const n of NAMES) players.push(await newPlayer(browser, baseURL!, vision, n));
  const everyone = [tal, ...players];
  const by = (n: string) => players.find((p) => p.name === n)!;

  let tUrl = "";
  let tid = "";
  const entries = async () =>
    (await db().from("tournament_entries").select("*, table_members!tournament_entries_member_id_fkey(display_name)").eq("tournament_id", tid)).data!.map((e) => ({
      ...e,
      name: (e.table_members as { display_name: string }).display_name,
    }));

  await test.step("the admin opens registration: 2 tables of 3, ₪100, rebuys to level 2, add-on", async () => {
    const p = tal.page;
    await p.goto("/tables");
    await btn(p, "שולחן חדש").click();
    await sheet(p).locator("input").fill("טורניר החבר'ה");
    await btn(sheet(p), "יצירת שולחן").click();
    await p.waitForURL(/\/t\/[A-Z0-9]{6}\?tab=players/);
    const code = new URL(p.url()).pathname.split("/")[2];
    await p.goto(`/t/${code}`);
    await btn(p, "טורניר חדש").click();
    const s = sheet(p);
    const row = (label: string) => s.locator("div.flex.items-center.justify-between", { hasText: label });
    await row("שולחנות").getByRole("button", { name: "יותר" }).click();
    for (let i = 0; i < 6; i++) await row("כיסאות בשולחן").getByRole("button", { name: "פחות" }).click();
    await expect(s.getByText("עד 6 שחקנים", { exact: false })).toBeVisible();
    await s.getByRole("group", { name: /ריביי/ }).getByRole("button", { name: "עד שלב 2" }).click();
    await s.getByRole("group", { name: "הרשמה מאוחרת" }).getByRole("button", { name: "בלי" }).click();
    await s.locator('input[type="checkbox"]').check();
    await btn(s, "פתיחת הרשמה לטורניר").click();
    await p.waitForURL(/\/tr\/[0-9a-f-]{36}$/);
    tUrl = new URL(p.url()).pathname;
    tid = tUrl.split("/").pop()!;
  });

  await test.step("seven register from the link, the seventh waits; one drops out and the waiting player moves up", async () => {
    for (const pl of players) {
      await pl.page.goto(tUrl);
      await btn(pl.page, pl === players[6] ? "לרשימת המתנה" : "הרשמה לטורניר").click();
      await expect(pl.page.getByText(pl === players[6] ? "ממתין (1)" : "אתה רשום")).toBeVisible();
    }
    const quitter = by("ורד");
    await btn(quitter.page, "יציאה מההרשמה").click();
    await expect(by("זיו").page.getByText("אתה רשום")).toBeVisible();
    const e = await entries();
    expect(e.filter((x) => x.status === "registered").map((x) => x.name).sort()).toEqual(["אורי", "בר", "גיא", "דנה", "הילה", "זיו"].sort());
    // registering also made them table members, without the admin approving (by design: the link is the invite)
    // a player cannot start the tournament
    const { error } = await by("אורי").api.rpc("start_tournament", { p_id: tid });
    expect(error?.message).toContain("admin only");
  });

  await test.step("the draw seats 3 and 3", async () => {
    await btn(tal.page, "הגרלת מקומות והתחלה").click();
    await expect(tal.page.getByText("שולחן 1 · 3 שחקנים")).toBeVisible();
    await expect(tal.page.getByText("שולחן 2 · 3 שחקנים")).toBeVisible();
    const e = await entries();
    expect(e.filter((x) => x.status === "playing")).toHaveLength(6);
    expect(new Set(e.filter((x) => x.status === "playing").map((x) => `${x.table_no}-${x.seat_no}`)).size).toBe(6);
  });

  /** Admin taps a player at the table and acts in the sheet. */
  async function tapPlayer(p: Page, name: string) {
    await p.locator("main button", { hasText: name }).first().click();
    await expect(sheet(p)).toBeVisible();
  }

  async function bust(name: string, byName?: string) {
    await tapPlayer(tal.page, name);
    const s = sheet(tal.page);
    if (byName) await s.locator("select").first().selectOption({ label: byName });
    await btn(s, "יצא מהטורניר").click();
    await expect(sheet(tal.page)).toHaveCount(0);
  }

  await test.step("bust-outs at table 1, the app balances the tables; a rebuy and an add-on", async () => {
    const e = await entries();
    const t1 = e.filter((x) => x.table_no === 1).map((x) => x.name);
    const t2 = e.filter((x) => x.table_no === 2).map((x) => x.name);
    await bust(t1[0], t1[1]);
    // the busted player buys back in while rebuys are open
    await tapPlayer(tal.page, t1[0]); // shown in the "out" list
    await btn(sheet(tal.page), /ריביי/).click();
    await expect.poll(async () => (await entries()).find((x) => x.name === t1[0])!.rebuys).toBe(1);

    // an add-on for someone at table 2
    await tapPlayer(tal.page, t2[0]);
    await btn(sheet(tal.page), /אד-און/).click();
    await expect.poll(async () => (await entries()).find((x) => x.name === t2[0])!.addon).toBe(true);

    // two out at table 1 -> 1 vs 3 -> move one over
    await bust(t1[1]);
    await bust(t1[2]);
    await expect(tal.page.getByText(/צריך לאזן שולחנות|אפשר לשבור שולחן/)).toBeVisible();
    await btn(tal.page, "להעביר").click();
    await expect(tal.page.getByText(/צריך לאזן שולחנות|אפשר לשבור שולחן/)).toHaveCount(0);
    const now = await entries();
    const counts = [1, 2].map((n) => now.filter((x) => x.status === "playing" && x.table_no === n).length).filter(Boolean);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // a player cannot bust someone
    const victim = now.find((x) => x.status === "playing")!;
    const { error } = await by("אורי").api.rpc("bust_player", { p_entry: victim.id });
    expect(error?.message).toContain("admin only");
  });

  await test.step("down to one: prizes add up to the pool and the transfers balance", async () => {
    let alive = (await entries()).filter((x) => x.status === "playing");
    while (alive.length > 1) {
      await bust(alive[alive.length - 1].name);
      alive = (await entries()).filter((x) => x.status === "playing");
    }
    await btn(tal.page, "יש מנצח! סיום הטורניר").click();
    const s = sheet(tal.page);
    // 6 buy-ins + 1 rebuy + 1 add-on = ₪800
    await expect(s.getByText(/מתוך\s*.?₪800/)).toBeVisible();
    await btn(s, "סיום וחישוב מי מעביר למי").click();
    await expect(tal.page.getByText("דירוג סופי")).toBeVisible();

    const e = await entries();
    const prizes = e.reduce((a, x) => a + Number(x.prize ?? 0), 0);
    expect(prizes).toBe(800);
    expect(e.map((x) => x.place).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(e.find((x) => x.place === 1)!.name).toBe(alive[0].name);
    const nets = e.map((x) => Number(x.prize ?? 0) - 100 - x.rebuys * 100 - (x.addon ? 100 : 0));
    expect(nets.reduce((a, b) => a + b, 0)).toBe(0);

    // everyone sees the result
    for (const pl of players.slice(0, 3)) {
      await pl.page.goto(tUrl);
      await expect(pl.page.getByText("דירוג סופי")).toBeVisible();
    }
  });

  for (const pl of everyone) expect(pl.errors, `errors on ${pl.name}'s phone`).toEqual([]);
  await Promise.all(everyone.map((pl) => pl.ctx.close()));
});
