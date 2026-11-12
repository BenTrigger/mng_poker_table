// A whole poker night, played by six people on six phones against a real
// (local) Supabase: requests, hand-overs with photos that match and don't,
// corrections, admin decisions, a late player, a cash-out, a cashier
// handover and the end-of-night settlement. Chip recognition is mocked so
// each photo "sees" exactly what the scenario says.
import { expect, test } from "@playwright/test";
import { btn, db, newPlayer, photograph, sheet, simConfigured, Vision, warmRealtime, type Player } from "./sim";

test.skip(!simConfigured, "needs a local Supabase (supabase start), see e2e-sim/README.md");

const RATE = 0.1; // 1000 chips = ₪100

/** What the database says, as the source of truth for every check. */
async function nightState(nightId: string) {
  const sb = db();
  const [{ data: players }, { data: requests }, { data: members }, { data: settlements }, { data: night }, { data: events }] = await Promise.all([
    sb.from("night_players").select("*").eq("night_id", nightId),
    sb.from("chip_requests").select("*").eq("night_id", nightId).order("created_at"),
    sb.from("table_members").select("*"),
    sb.from("settlements").select("*").eq("night_id", nightId),
    sb.from("game_nights").select("*").eq("id", nightId).single(),
    sb.from("night_events").select("*").eq("night_id", nightId).order("id"),
  ]);
  const idOf = (name: string) => members!.find((m) => m.display_name === name && m.table_id === night!.table_id)!.id;
  const bought = (name: string) =>
    requests!.filter((r) => r.member_id === idOf(name) && r.status === "approved").reduce((s, r) => s + Number(r.given_chips ?? r.chips), 0);
  return { players: players!, requests: requests!, settlements: settlements!, night: night!, events: events!, idOf, bought };
}

test("a full game night with six players", async ({ browser, baseURL }) => {
  test.setTimeout(6 * 60_000);
  await warmRealtime();
  const vision = new Vision();
  const join = (name: string) => newPlayer(browser, baseURL!, vision, name);

  const dana = await join("דנה"); // admin
  const yossi = await join("יוסי"); // first cashier
  const avi = await join("אבי");
  const michal = await join("מיכל"); // second cashier
  const ron = await join("רון");
  const everyone: Player[] = [dana, yossi, avi, michal, ron];
  let code = "";
  let nightUrl = "";
  let nightId = "";

  await test.step("admin creates the table, friends join with the link", async () => {
    const p = dana.page;
    await p.goto("/tables");
    await btn(p, "שולחן חדש").click();
    await sheet(p).locator("input").fill("ערב פוקר סימולציה");
    await btn(sheet(p), "יצירת שולחן").click();
    await p.waitForURL(/\/t\/[A-Z0-9]{6}\?tab=players/);
    code = new URL(p.url()).pathname.split("/")[2];

    // the table link is the invite: each friend lands straight in the table
    for (const pl of [yossi, avi, michal, ron]) {
      await pl.page.goto(`/join/${code}`);
      await pl.page.waitForURL(new RegExp(`/t/${code}$`));
      await expect(pl.page.getByRole("heading", { name: "ערב פוקר סימולציה" })).toBeVisible();
    }
    const { data: t } = await db().from("poker_tables").select("id").eq("code", code).single();
    await expect
      .poll(async () => (await db().from("table_members").select("id").eq("table_id", t!.id).eq("status", "active")).data?.length, {
        message: "the friends joined the table",
      })
      .toBe(5);
    // the admin sees them arrive live
    for (const pl of [yossi, avi, michal, ron]) {
      await expect(p.locator("main").getByText(pl.name, { exact: true }).first(), "new members show up live on the admin's phone").toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("admin opens the night: chip set, 1000 chips = ₪100, Yossi is the cashier", async () => {
    const p = dana.page;
    await p.goto(`/t/${code}/new-night`);
    await btn(p, "הגדרת ערכת צ'יפים").click();
    await btn(sheet(p), "שמירת ערכה").click();
    await expect(p.getByText("הערכה שלנו")).toBeVisible();
    await expect(p.getByText("מי משחק הערב (5/10)")).toBeVisible();
    const row = p.locator("div.rounded-2xl", { hasText: "יוסי" }).filter({ has: p.getByRole("button", { name: "קופאי" }) });
    await row.getByRole("button", { name: "קופאי" }).click();
    await btn(p, /פתיחת הערב/).click();
    await p.waitForURL(/\/n\/[0-9a-f-]{36}$/);
    nightUrl = new URL(p.url()).pathname;
    nightId = nightUrl.split("/").pop()!;
    await expect(p.getByText("קופאי: יוסי")).toBeVisible();

    // players find the open night from the table screen
    for (const pl of [yossi, avi, michal, ron]) {
      await pl.page.goto(`/t/${code}`);
      await pl.page.getByText("כניסה לשולחן").click();
      await pl.page.waitForURL(nightUrl);
      await expect(pl.page.getByText("קופאי: יוסי")).toBeVisible();
    }
    // only the cashier and the admin get the cash box
    await expect(btn(yossi.page, /^קופה/)).toBeVisible();
    await expect(btn(avi.page, /^קופה/)).toHaveCount(0);
  });

  const cashier = () => (cashierNow === "יוסי" ? yossi : michal);
  let cashierNow = "יוסי";

  /** A player asks for chips on their phone. */
  async function request(pl: Player, how: { chips?: number; money?: number; quick?: string }) {
    const p = pl.page;
    await btn(p, "בקשת צ'יפים").first().click();
    const s = sheet(p);
    if (how.quick) await s.getByRole("button").filter({ has: p.getByText(how.quick, { exact: true }) }).click();
    if (how.money != null) {
      await btn(s, "לפי סכום ₪").click();
      await s.locator("input.h-16").fill(String(how.money));
    }
    if (how.chips != null) await s.locator("input.h-16").fill(String(how.chips));
    await btn(s, "שליחה לקופאי").click();
    await expect(s).toHaveCount(0);
  }

  /** The cashier opens the queue and starts the hand-over for this player. */
  async function startHandover(name: string, chips: number) {
    const p = cashier().page;
    await btn(p, /^קופה/).click();
    const card = sheet(p).locator("div.rounded-3xl", { hasText: name }).filter({ hasText: `${chips.toLocaleString()} צ'יפים` });
    await card.getByRole("button", { name: "מסירה וצילום" }).click();
    await expect(sheet(p).getByText("ביקש")).toBeVisible();
  }

  await test.step("Avi asks for a buy-in, the cashier hands it over and the photo matches", async () => {
    await request(avi, { quick: "כניסה" });
    await expect(avi.page.getByText("ממתין 1,000")).toBeVisible();
    // the cashier is buzzed live
    await expect(yossi.page.getByText("בקשה חדשה: אבי · 1,000 צ'יפים")).toBeVisible();
    await startHandover("אבי", 1000);
    vision.sees(1000);
    await photograph(yossi.page, 1000);
    await btn(sheet(yossi.page), "מסרתי, אישור").click();
    await expect(sheet(yossi.page).getByText("אין בקשות פתוחות")).toBeVisible();
    await btn(sheet(yossi.page), "סגור").click();
    // Avi's phone updates by itself
    await expect(avi.page.locator("main").getByText("אני בערב הזה").locator("..")).toContainText("₪100");
  });

  await test.step("Michal asks for ₪50, the cashier hands 450 by mistake and records what was really handed", async () => {
    await request(michal, { money: 50 });
    await expect(michal.page.getByText("ממתין 500")).toBeVisible();
    await startHandover("מיכל", 500);
    vision.sees(450);
    await photograph(yossi.page, 450);
    await btn(sheet(yossi.page), "מסרתי, אישור").click();
    await expect(sheet(yossi.page).getByText("הסכום לא תואם לבקשה")).toBeVisible();
    await expect(sheet(yossi.page).getByText("ביקש 500 · בתמונה זוהו 450")).toBeVisible();
    await btn(sheet(yossi.page), "מסרתי בפועל 450, לרשום את זה").click();
    await expect(sheet(yossi.page).getByText("אין בקשות פתוחות")).toBeVisible();
    await btn(sheet(yossi.page), "סגור").click();
    const st = await nightState(nightId);
    expect(st.bought("מיכל")).toBe(450);
    expect(st.events.some((e) => e.kind === "manual_correction" && e.payload.given === 450 && e.payload.requested === 500)).toBe(true);
  });

  await test.step("Ron asks for a double buy-in, the photo misses chips, the cashier insists and the admin approves", async () => {
    await request(ron, { quick: "כניסה כפולה" });
    await startHandover("רון", 2000);
    vision.sees(1800);
    await photograph(yossi.page, 1800);
    await btn(sheet(yossi.page), "מסרתי, אישור").click();
    await btn(sheet(yossi.page), /מסרתי 2,000, הזיהוי שגוי/).click();
    await expect(sheet(yossi.page).getByText("ממתין לאישור מנהל")).toBeVisible();
    await btn(sheet(yossi.page), "סגור").click();
    // flagged chips do not count yet
    expect((await nightState(nightId)).bought("רון")).toBe(0);
    // the admin gets a warning on the main screen
    await expect(dana.page.getByText("1 מסירות לא תואמות")).toBeVisible();
    await dana.page.getByText("1 מסירות לא תואמות").click();
    await expect(sheet(dana.page).getByText("הקופאי מסר 2,000, בתמונה זוהו 1,800")).toBeVisible();
    await btn(sheet(dana.page), "תקין, 2,000").click();
    await expect(sheet(dana.page).getByText("אין בקשות פתוחות")).toBeVisible();
    await btn(sheet(dana.page), "סגור").click();
    await expect(dana.page.getByText("מסירות לא תואמות")).toHaveCount(0);
    expect((await nightState(nightId)).bought("רון")).toBe(2000);
  });

  await test.step("Avi rebuys, the photo sees 1,100, the cashier fixes the black chips by hand and approves", async () => {
    await request(avi, { chips: 1000 });
    await startHandover("אבי", 1000);
    vision.sees(1100); // 2 purple + 1 black
    await photograph(yossi.page, 1100);
    const s = sheet(yossi.page);
    await s.getByRole("button", { name: "פחות שחור" }).click();
    await expect(s.getByLabel("סה״כ צ'יפים")).toHaveValue("1000");
    await btn(s, "מסרתי, אישור").click();
    // the cashier's own count matches the request: approved at once, and the correction is logged
    await expect(sheet(yossi.page).getByText("אין בקשות פתוחות")).toBeVisible();
    await btn(sheet(yossi.page), "סגור").click();
    const st = await nightState(nightId);
    expect(st.bought("אבי")).toBe(2000);
    const last = st.requests.filter((r) => r.member_id === st.idOf("אבי")).pop()!;
    expect(Number(last.detected_chips)).toBe(1100);
    expect(st.events.some((e) => e.kind === "count_corrected" && e.payload.request_id === last.id)).toBe(true);
    // the per-colour fix is saved to the chip set to help the next recognition
    await expect.poll(async () => (await db().from("chip_corrections").select("id").eq("chip_set_id", st.night.chip_set_id)).data?.length).toBe(1);
  });

  await test.step("a request sent by mistake is rejected, the admin and the cashier buy in themselves", async () => {
    await request(avi, { chips: 500 });
    const p = yossi.page;
    await btn(p, /^קופה/).click();
    await sheet(p).locator("div.rounded-3xl", { hasText: "אבי" }).getByRole("button", { name: "דחייה" }).click();
    await expect(sheet(p).getByText("אין בקשות פתוחות")).toBeVisible();
    await btn(sheet(p), "סגור").click();

    await request(dana, { quick: "כניסה" });
    await request(yossi, { quick: "כניסה" });
    for (const name of ["דנה", "יוסי"]) {
      await startHandover(name, 1000);
      vision.sees(1000);
      await photograph(yossi.page, 1000);
      await btn(sheet(yossi.page), "מסרתי, אישור").click();
      await expect(sheet(yossi.page).getByRole("heading", { name: "קופה" })).toBeVisible();
      await btn(sheet(yossi.page), "סגור").click();
    }
    const st = await nightState(nightId);
    expect([st.bought("דנה"), st.bought("יוסי"), st.bought("אבי")]).toEqual([1000, 1000, 2000]);
  });

  const noa = await join("נועה");
  everyone.push(noa);
  await test.step("Noa arrives late: joins the table, the admin seats her, she buys in; a guest added by mistake is removed", async () => {
    await noa.page.goto(`/join/${code}`);
    await noa.page.waitForURL(new RegExp(`/t/${code}$`));

    await btn(dana.page, "ניהול הערב").click();
    const s = sheet(dana.page);
    await s.locator("div.flex.items-center.gap-3", { hasText: "נועה" }).getByRole("button", { name: "הוספה" }).click();
    await s.getByPlaceholder("אורח חדש (רק שם)").fill("אורח");
    await s.getByPlaceholder("אורח חדש (רק שם)").locator("..").getByRole("button", { name: "הוספה" }).click();
    const guestRow = s.locator("div.flex.items-center.gap-3", { hasText: "אורח" });
    await guestRow.getByRole("button", { name: "הסרה" }).click();
    // off the night, back in the "can be added" list
    await expect(guestRow.getByRole("button", { name: "הסרה" })).toHaveCount(0);
    await expect(guestRow.getByRole("button", { name: "הוספה" })).toBeVisible();
    await btn(s, "סגור").click();

    await noa.page.goto(nightUrl);
    await request(noa, { quick: "כניסה" });
    await startHandover("נועה", 1000);
    vision.sees(1000);
    await photograph(yossi.page, 1000);
    await btn(sheet(yossi.page), "מסרתי, אישור").click();
    await expect(sheet(yossi.page).getByRole("heading", { name: "קופה" })).toBeVisible();
    await btn(sheet(yossi.page), "סגור").click();
    const st = await nightState(nightId);
    expect(st.bought("נועה")).toBe(1000);
    expect(st.players.map((p) => p.member_id)).not.toContain(st.idOf("אורח"));
  });

  await test.step("Ron leaves with 2,600 chips while he still has a request open", async () => {
    await request(ron, { quick: "כניסה" });
    await dana.page.locator("main button", { hasText: "רון" }).first().click();
    await btn(sheet(dana.page), "קם מהשולחן: ספירה וסגירת חוב").click();
    vision.sees(2600);
    await photograph(dana.page, 2600);
    await btn(sheet(dana.page), "סגירת החשבון שלו").click();
    await expect(sheet(dana.page)).toHaveCount(0);
    const st = await nightState(nightId);
    const ronRow = st.players.find((p) => p.member_id === st.idOf("רון"))!;
    expect(ronRow.status).toBe("out");
    expect(Number(ronRow.net)).toBe(60); // 2,600 chips = ₪260, bought ₪200
    // his open request must not turn into debt after he left
    expect(st.requests.filter((r) => r.member_id === st.idOf("רון") && r.status === "pending")).toHaveLength(0);
    await expect(btn(ron.page, "בקשת צ'יפים")).toHaveCount(0);
  });

  await test.step("Yossi goes home: the cashier role moves to Michal with a full count", async () => {
    const p = dana.page;
    await btn(p, "ניהול הערב").click();
    await btn(sheet(p), "העברת הקופה לקופאי אחר (עם ספירה)").click();
    await btn(sheet(p), "מיכל").click();
    await expect(sheet(p).getByText("יוסי גם עוזב את המשחק")).toBeVisible();
    await btn(sheet(p), "המשך לספירה").click();
    // stacks on the table: 4,850 = everything handed (7,450) minus what Ron took (2,600)
    const stacks: [string, number][] = [["דנה", 700], ["יוסי", 1500], ["אבי", 1200], ["מיכל", 650], ["נועה", 800]];
    for (const [name, chips] of stacks) {
      await sheet(p).locator("button", { hasText: name }).filter({ hasText: "קנה" }).click();
      vision.sees(chips);
      await photograph(p, chips);
      await btn(sheet(p), "שמירת ספירה").click();
    }
    await expect(sheet(p).getByText("הכל מאוזן, אפשר להעביר")).toBeVisible();
    await expect(sheet(p).getByText("יוסי יוצא עם 1,500 צ'יפים")).toBeVisible();
    await btn(sheet(p), "העברת הקופה למיכל").click();
    await expect(sheet(p)).toHaveCount(0);
    cashierNow = "מיכל";

    await expect(michal.page.getByText("קופאי: מיכל")).toBeVisible();
    await expect(btn(michal.page, /^קופה/)).toBeVisible();
    await expect(btn(yossi.page, /^קופה/)).toHaveCount(0);
    const st = await nightState(nightId);
    expect(Number(st.players.find((x) => x.member_id === st.idOf("יוסי"))!.net)).toBe(50);
  });

  await test.step("Michal, the new cashier, serves Avi's rebuy", async () => {
    await request(avi, { quick: "כניסה" });
    await startHandover("אבי", 1000);
    vision.sees(1000);
    await photograph(michal.page, 1000);
    await btn(sheet(michal.page), "מסרתי, אישור").click();
    await expect(sheet(michal.page).getByRole("heading", { name: "קופה" })).toBeVisible();
    await btn(sheet(michal.page), "סגור").click();
    expect((await nightState(nightId)).bought("אבי")).toBe(3000);
  });

  await test.step("an open dispute blocks closing the night until the admin decides by the photo", async () => {
    await request(noa, { quick: "כניסה" });
    await startHandover("נועה", 1000);
    vision.sees(900);
    await photograph(michal.page, 900);
    await btn(sheet(michal.page), "מסרתי, אישור").click();
    await btn(sheet(michal.page), /מסרתי 1,000, הזיהוי שגוי/).click();
    await expect(sheet(michal.page).getByText("ממתין לאישור מנהל")).toBeVisible();
    await btn(sheet(michal.page), "סגור").click();

    // Noa cannot be cashed out while her hand-over is disputed
    await dana.page.locator("main button", { hasText: "נועה" }).first().click();
    await expect(sheet(dana.page).getByText("יש מסירה שממתינה לאישור מנהל")).toBeVisible();
    await expect(btn(sheet(dana.page), "קם מהשולחן: ספירה וסגירת חוב")).toBeDisabled();
    await btn(sheet(dana.page), "סגור").click();

    // nor can the night be closed
    await btn(dana.page, "סגירת ערב").click();
    await expect(sheet(dana.page).getByText(/מסירות שממתינות להחלטה שלך/)).toBeVisible();
    await btn(sheet(dana.page), "סגור").click();

    await dana.page.getByText("1 מסירות לא תואמות").click();
    await btn(sheet(dana.page), "לפי התמונה, 900").click();
    await expect(sheet(dana.page).getByText("אין בקשות פתוחות")).toBeVisible();
    await btn(sheet(dana.page), "סגור").click();
    expect((await nightState(nightId)).bought("נועה")).toBe(1900);
  });

  await test.step("end of night: count everyone, 50 chips are missing, settle and close", async () => {
    const p = dana.page;
    await btn(p, "סגירת ערב").click();
    // handed 9,350; out: Ron 2,600 + Yossi 1,500; on the table should be 5,250, counted 5,200
    const stacks: [string, number][] = [["דנה", 500], ["אבי", 2800], ["מיכל", 400], ["נועה", 1500]];
    for (const [name, chips] of stacks) {
      await sheet(p).locator("button", { hasText: name }).filter({ hasText: "קנה" }).click();
      vision.sees(chips);
      await photograph(p, chips);
      await btn(sheet(p), "שמירת ספירה").click();
    }
    await expect(sheet(p).getByText(/חוסר של 50 צ'יפים/)).toBeVisible();
    await btn(sheet(p), "סגירה סופית").click();
    await expect(p.getByText("שיתוף הסיכום לוואטסאפ")).toBeVisible();

    const st = await nightState(nightId);
    expect(st.night.status).toBe("closed");
    expect(st.night.photos_purged).toBe(true);
    // the night balances to the agora: winners get exactly what losers pay
    const nets = st.players.map((x) => Number(x.net));
    expect(Math.abs(Math.round(nets.reduce((a, b) => a + b, 0) * 100))).toBe(0);
    const paid = new Map<string, number>();
    for (const s of st.settlements) {
      paid.set(s.from_member, (paid.get(s.from_member) ?? 0) - Number(s.amount));
      paid.set(s.to_member, (paid.get(s.to_member) ?? 0) + Number(s.amount));
    }
    for (const x of st.players) expect(Math.round((paid.get(x.member_id) ?? 0) * 100) + 0, `transfers for ${x.member_id}`).toBe(Math.round(Number(x.net) * 100) + 0);
    // the photos are gone from storage
    const { data: files } = await db().storage.from("chip-photos").list(nightId);
    expect(files ?? []).toHaveLength(0);
    // money check: what everyone bought, in shekels
    expect(st.bought("אבי") * RATE).toBe(300);
  });

  await test.step("everyone sees the summary and a winner marks a transfer as paid", async () => {
    for (const pl of everyone) {
      await pl.page.goto(nightUrl);
      await expect(pl.page.getByText(/סיכום ערב/)).toBeVisible();
    }
    const st = await nightState(nightId);
    const s = st.settlements.find((x) => x.to_member === st.idOf("רון"))!;
    expect(s).toBeTruthy();
    const row = ron.page.locator("div.rounded-2xl", { hasText: "רון" }).filter({ has: ron.page.getByRole("button", { name: "שולם" }) }).first();
    await row.getByRole("button", { name: "שולם" }).click();
    await expect.poll(async () => (await db().from("settlements").select("paid").eq("id", s.id).single()).data?.paid).toBe(true);
  });

  for (const pl of everyone) expect(pl.errors, `errors on ${pl.name}'s phone`).toEqual([]);
  await Promise.all(everyone.map((pl) => pl.ctx.close()));
});
