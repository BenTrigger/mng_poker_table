// Getting people to the table and the table's rules: joining by code (approve
// and reject), a personal invite link, an early sign-up with seats, a waiting
// list and cancellations, host and address edits, opening the night from the
// sign-up, "each player sees only their own" results, settling through the
// cashier, and what a regular player must not be able to do through the API.
import { expect, test, type Page } from "@playwright/test";
import { btn, db, newPlayer, sheet, simConfigured, Vision, warmRealtime, type Player } from "./sim";

test.skip(!simConfigured, "needs a local Supabase (supabase start), see e2e-sim/README.md");

/** Count a stack by typing the total (no photo). */
async function typeCount(page: Page, chips: number, cta: string) {
  const s = sheet(page);
  await s.getByLabel("סה״כ צ'יפים").fill(String(chips));
  await btn(s, cta).click();
}

const seatButton = (page: Page, n: number) => page.locator("main button", { hasText: `#${n}` });

test("invites, early sign-up with seats, table rules and permissions", async ({ browser, baseURL }) => {
  test.setTimeout(6 * 60_000);
  await warmRealtime();
  const vision = new Vision();
  const join = (name: string) => newPlayer(browser, baseURL!, vision, name);
  const alon = await join("אלון"); // admin
  const beni = await join("בני");
  const gal = await join("גל");
  const dor = await join("דור");
  const hadar = await join("הדר");
  const vered = await join("ורד");
  const stranger = await join("זר");
  const everyone: Player[] = [alon, beni, gal, dor, hadar, vered, stranger];

  let code = "";
  let tableId = "";
  const memberId = async (name: string) =>
    (await db().from("table_members").select("id").eq("table_id", tableId).eq("display_name", name).single()).data!.id as string;

  await test.step("joining by code: the admin approves one and rejects a stranger", async () => {
    await alon.page.goto("/tables");
    await btn(alon.page, "שולחן חדש").click();
    await sheet(alon.page).locator("input").fill("שולחן הרשמות");
    await btn(sheet(alon.page), "יצירת שולחן").click();
    await alon.page.waitForURL(/\/t\/[A-Z0-9]{6}\?tab=players/);
    code = new URL(alon.page.url()).pathname.split("/")[2];
    tableId = (await db().from("poker_tables").select("id").eq("code", code).single()).data!.id;

    for (const pl of [hadar, stranger]) {
      await pl.page.goto("/tables");
      await btn(pl.page, "הצטרפות בקוד").click();
      await sheet(pl.page).locator("input").fill(code.toLowerCase());
      await btn(sheet(pl.page), "המשך").click();
      await expect(pl.page.getByRole("heading", { name: "שולחן הרשמות" })).toBeVisible();
      await btn(pl.page, "הצטרפות").click();
      await expect(pl.page.getByText("הבקשה נשלחה")).toBeVisible();
    }
    await expect(alon.page.getByText("מבקשים להצטרף (2)")).toBeVisible({ timeout: 20_000 });
    const card = (name: string) => alon.page.locator("div.rounded-3xl", { hasText: name }).filter({ has: alon.page.getByRole("button", { name: "אישור" }) });
    await card("זר").getByRole("button", { name: "דחייה" }).click();
    await card("הדר").getByRole("button", { name: "אישור" }).click();
    await expect(alon.page.getByText("מבקשים להצטרף")).toHaveCount(0);

    // the stranger sees nothing of the table, even through the API
    const { data: peek } = await stranger.api.from("poker_tables").select("*").eq("id", tableId);
    expect(peek).toEqual([]);
    const { data: members } = await stranger.api.from("table_members").select("*").eq("table_id", tableId);
    expect(members).toEqual([]);
    // a wrong code says so
    await stranger.page.goto("/join/ZZZZZZ");
    await expect(stranger.page.getByText("שולחן לא נמצא")).toBeVisible();
  });

  await test.step("a personal invite link links a guest to their Google account at once", async () => {
    await alon.page.goto(`/t/${code}?tab=players`);
    await btn(alon.page, "הוספה").first().click();
    await sheet(alon.page).locator("input").fill("ורד");
    await btn(sheet(alon.page), "הוספה").click();
    await expect(alon.page.getByText("עוד לא נרשם לאפליקציה")).toBeVisible();
    const id = await memberId("ורד");
    await vered.page.goto(`/join/${code}?m=${id}`);
    await vered.page.waitForURL(new RegExp(`/t/${code}$`));
    const m = (await db().from("table_members").select("*").eq("id", id).single()).data!;
    expect(m.user_id).toBe(vered.userId);
    expect(m.status).toBe("active");
  });

  let signupUrl = "";
  await test.step("the admin opens an early sign-up for 3 seats with host and address", async () => {
    await alon.page.goto(`/t/${code}`);
    await btn(alon.page, "הרשמה מוקדמת").click();
    const s = sheet(alon.page);
    await s.getByRole("group", { name: "כמה מקומות בשולחן" }).getByRole("button", { name: "4" }).click();
    await s.getByPlaceholder("אצל יוסי").fill("אצל אלון");
    await s.getByPlaceholder("הרצל 10, תל אביב").fill("הרצל 1, חיפה");
    await btn(s, "פתיחת הרשמה").click();
    await alon.page.waitForURL(/\/s\/[0-9a-f-]{36}$/);
    signupUrl = new URL(alon.page.url()).pathname;
    await expect(alon.page.getByText("אצל אלון")).toBeVisible();
    await expect(alon.page.getByRole("link", { name: /ניווט בוויז/ })).toHaveAttribute("href", /waze\.com\/ul\?q=/);
    await btn(alon.page, "פחות").click(); // 4 -> 3 seats
    await expect(alon.page.locator("main").getByText("0/3")).toBeVisible();
  });

  await test.step("players take seats from the link (even before joining the table), the fourth waits", async () => {
    await beni.page.goto(signupUrl);
    await btn(beni.page, "תפוס לי מקום").click();
    await expect(beni.page.getByText("אתה במקום 1")).toBeVisible();

    await gal.page.goto(signupUrl);
    await seatButton(gal.page, 3).click();
    await expect(gal.page.getByText("אתה במקום 3")).toBeVisible();

    await dor.page.goto(signupUrl);
    await btn(dor.page, "תפוס לי מקום").click();
    await expect(dor.page.getByText("אתה במקום 2")).toBeVisible();

    await hadar.page.goto(signupUrl);
    await expect(hadar.page.getByText("השולחן מלא")).toBeVisible();
    await btn(hadar.page, "הצטרפות לרשימת המתנה").click();
    await expect(hadar.page.getByText("ממתין (1)")).toBeVisible();

    // the admin wants to play too and goes on the waiting list after Hadar
    await alon.page.reload();
    await btn(alon.page, "גם אני משחק: תפוס לי מקום").click();
    await expect(alon.page.getByText("אתה ברשימת ההמתנה")).toBeVisible();
    // the seat taker joined the table through the link
    expect((await db().from("table_members").select("status").eq("table_id", tableId).eq("user_id", beni.userId).single()).data!.status).toBe("active");
  });

  await test.step("the admin changes the address; players see it live", async () => {
    await btn(alon.page, "עריכת תאריך, מארח וכתובת").click();
    const s = sheet(alon.page);
    await s.getByPlaceholder("הרצל 10, תל אביב").fill("הנביאים 5, חיפה");
    await btn(s, "שמירה").click();
    await expect(beni.page.getByText("הנביאים 5, חיפה")).toBeVisible();
  });

  await test.step("after registration closes, a player can still cancel and the waiting list moves up", async () => {
    await btn(alon.page, "סגירת הרשמה").click();
    await expect(beni.page.getByText("ההרשמה סגורה").first()).toBeVisible();
    await btn(beni.page, "ביטול הרשמה").click();
    await expect(beni.page.getByText("ההרשמה שלך בוטלה")).toBeVisible();
    await expect(hadar.page.getByText("אתה במקום 1")).toBeVisible();
    // and the admin can give up their own waiting-list place
    await btn(alon.page, "ביטול הכיסא שלי").click();
    await expect(alon.page.getByText("אתה ברשימת ההמתנה")).toHaveCount(0);
    const { data: rows } = await db().from("signup_seats").select("member_id, seat").eq("signup_id", signupUrl.split("/").pop()!);
    expect(rows!.map((r) => r.seat).sort()).toEqual([1, 2, 3]);
  });

  let nightUrl = "";
  await test.step("the table rules: each player sees only their own results, settling through the cashier", async () => {
    await alon.page.goto(`/t/${code}?tab=settings`);
    await btn(alon.page, "כל אחד רק את שלו").click();
    await btn(alon.page, "הכל דרך הקופאי").click();
    await expect.poll(async () => (await db().from("poker_tables").select("last_settings").eq("id", tableId).single()).data!.last_settings)
      .toMatchObject({ stats_visibility: "own", settle_mode: "cashier" });
    // a player cannot change them
    const { data: changed } = await dor.api.from("poker_tables").update({ last_settings: { stats_visibility: "all" } }).eq("id", tableId).select();
    expect(changed).toEqual([]);
  });

  await test.step("the night opens from the sign-up with the seated players; seats can no longer be cancelled", async () => {
    await alon.page.goto(signupUrl);
    await btn(alon.page, "פתיחת הערב עם הרשומים (3)").click();
    await alon.page.waitForURL(/new-night\?signup=/);
    await expect(alon.page.getByText("השחקנים והמקומות נטענו מההרשמה המוקדמת (3 רשומים)")).toBeVisible();
    await btn(alon.page, "הגדרת ערכת צ'יפים").click();
    await btn(sheet(alon.page), "שמירת ערכה").click();
    const row = alon.page.locator("div.rounded-2xl", { hasText: "גל" }).filter({ has: alon.page.getByRole("button", { name: "קופאי" }) });
    await row.getByRole("button", { name: "קופאי" }).click();
    await btn(alon.page, /פתיחת הערב/).click();
    await alon.page.waitForURL(/\/n\/[0-9a-f-]{36}$/);
    nightUrl = new URL(alon.page.url()).pathname;
    const nightId = nightUrl.split("/").pop()!;
    const { data: players } = await db().from("night_players").select("member_id, seat").eq("night_id", nightId).order("seat");
    expect(players!.map((p) => p.member_id)).toEqual([await memberId("הדר"), await memberId("דור"), await memberId("גל")]);

    await dor.page.goto(signupUrl);
    await expect(btn(dor.page, "לערב הפעיל")).toBeVisible();
    await expect(btn(dor.page, "ביטול הרשמה")).toHaveCount(0);
    const { error } = await dor.api.rpc("leave_signup", { p_signup: signupUrl.split("/").pop() });
    expect(error?.message).toContain("signup already started");
  });

  await test.step("a short night; a player cannot approve their own chips or appoint themself cashier", async () => {
    const nightId = nightUrl.split("/").pop()!;
    for (const pl of [hadar, dor, gal]) await pl.page.goto(nightUrl);
    await btn(dor.page, "בקשת צ'יפים").click();
    await btn(sheet(dor.page), "שליחה לקופאי").click();

    // through the API, behind the app's back
    await expect(dor.page.getByText("ממתין 1,000")).toBeVisible();
    const { data: mine } = await dor.api.from("chip_requests").select("id").eq("night_id", nightId);
    const { data: approved } = await dor.api.from("chip_requests").update({ status: "approved", given_chips: 5000 }).eq("id", mine![0].id).select();
    expect(approved).toEqual([]);
    const { data: madeCashier } = await dor.api.from("game_nights").update({ cashier_member_id: await memberId("דור") }).eq("id", nightId).select();
    expect(madeCashier).toEqual([]);
    const { error: forged } = await dor.api.from("night_events").insert({ night_id: nightId, actor_id: gal.userId, kind: "approved", payload: {} });
    expect(forged).not.toBeNull();
    const { error: forOther } = await dor.api.from("chip_requests").insert({ night_id: nightId, member_id: await memberId("הדר"), mode: "chips", chips: 100 });
    expect(forOther).not.toBeNull();

    for (const pl of [hadar, gal]) {
      await btn(pl.page, "בקשת צ'יפים").click();
      await btn(sheet(pl.page), "שליחה לקופאי").click();
    }
    // Gal is the cashier and counts by hand (no photo)
    for (const name of ["דור", "הדר", "גל"]) {
      await btn(gal.page, /^קופה/).click();
      await sheet(gal.page).locator("div.rounded-3xl", { hasText: name }).getByRole("button", { name: "מסירה וצילום" }).click();
      await typeCount(gal.page, 1000, "מסרתי, אישור");
      await expect(sheet(gal.page).getByRole("heading", { name: "קופה" })).toBeVisible();
      await btn(sheet(gal.page), "סגור").click();
    }
    // the admin is not playing tonight but runs the close
    await btn(alon.page, "סגירת ערב").click();
    for (const [name, chips] of [["הדר", 1500], ["דור", 500], ["גל", 1000]] as const) {
      await sheet(alon.page).locator("button", { hasText: name }).filter({ hasText: "קנה" }).click();
      await typeCount(alon.page, chips, "שמירת ספירה");
    }
    await expect(sheet(alon.page).getByText("הכל מאוזן, אין חוסרים")).toBeVisible();
    // the table's default: everything through the cashier
    await expect(sheet(alon.page).getByText("מי מעביר למי (2 העברות)")).toBeVisible();
    await btn(sheet(alon.page), "סגירה סופית").click();
    await expect(alon.page.getByText("שיתוף הסיכום לוואטסאפ")).toBeVisible();
    const { data: transfers } = await db().from("settlements").select("*").eq("night_id", nightId);
    const g = await memberId("גל");
    expect(transfers!.every((t) => t.from_member === g || t.to_member === g)).toBe(true);
    expect(transfers!.map((t) => Number(t.amount)).sort()).toEqual([50, 50]);
  });

  await test.step("each player sees only their own result; the admin sees everyone", async () => {
    await dor.page.goto(nightUrl);
    await expect(dor.page.getByText(/סיכום ערב/)).toBeVisible();
    const summary = dor.page.locator("main div.divide-y").first();
    await expect(summary.locator("> div")).toHaveCount(1);
    await expect(summary).toContainText("דור");
    await expect(btn(dor.page, "שיתוף הסיכום לוואטסאפ")).toHaveCount(0);
    await dor.page.goto(`/t/${code}?tab=stats`);
    await expect(dor.page.getByText("המנהל הגדיר שכל שחקן רואה רק את הנתונים שלו")).toBeVisible();
    await expect(dor.page.locator("main").getByText("הדר")).toHaveCount(0);

    // a debtor cannot mark their own debt as paid; the creditor can
    const nightId = nightUrl.split("/").pop()!;
    const { data: t } = await db().from("settlements").select("*").eq("night_id", nightId).eq("from_member", await memberId("דור")).single();
    const { data: selfPaid } = await dor.api.from("settlements").update({ paid: true }).eq("id", t!.id).select();
    expect(selfPaid).toEqual([]);
    const { error: changeAmount } = await gal.api.from("settlements").update({ amount: 1 }).eq("id", t!.id);
    expect(changeAmount?.message).toContain("only the admin");
    const { data: paid } = await gal.api.from("settlements").update({ paid: true, paid_at: new Date().toISOString() }).eq("id", t!.id).select();
    expect(paid).toHaveLength(1);

    // nobody but the owner can delete the table
    const { data: gone } = await gal.api.from("poker_tables").delete().eq("id", tableId).select();
    expect(gone).toEqual([]);
  });

  for (const pl of everyone) expect(pl.errors, `errors on ${pl.name}'s phone`).toEqual([]);
  await Promise.all(everyone.map((pl) => pl.ctx.close()));
});
