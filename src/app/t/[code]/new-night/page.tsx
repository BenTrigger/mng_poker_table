"use client";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Landmark, Pencil, Plus, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { addGuest as addGuestByName } from "@/lib/guests";
import { useAuth, useTable, logEvent } from "@/lib/hooks";
import { TopBar } from "@/components/top-bar";
import { Avatar, Button, Card, ChipDot, Field, Sheet, Spinner, inputCls } from "@/components/ui";
import { ChipSetEditor } from "@/components/chip-set-editor";
import { ChipSetImport } from "@/components/chip-set-import";
import { formatMoney } from "@/lib/calc";
import type { Chip, ChipSet, SignupSettings } from "@/lib/types";
import { DEFAULT_CHIPS } from "@/lib/chips";

const MAX_PLAYERS = 10;

export default function NewNight({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const { user, loading } = useAuth();
  const t = useTable(code, user?.id);

  const [chipSetId, setChipSetId] = useState<string>("");
  const [nightName, setNightName] = useState("");
  const [chipsPer, setChipsPer] = useState(1000);
  const [moneyPer, setMoneyPer] = useState(100);
  const [selected, setSelected] = useState<string[]>([]);
  const [cashier, setCashier] = useState<string>("");
  // food: every player except the host pays the host, apart from the chips (Ben's table: ₪50)
  const [foodFee, setFoodFee] = useState(50);
  const [host, setHost] = useState<string>("");
  const rememberedHost = useRef<string | undefined>(undefined);
  const [editing, setEditing] = useState<ChipSet | "new" | null>(null);
  const [guest, setGuest] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [init, setInit] = useState(false);

  // memory from last night
  useEffect(() => {
    if (!t.table || init) return;
    const ls = t.table.last_settings ?? {};
    const active = t.members.filter((m) => m.status === "active").map((m) => m.id);
    setChipSetId(ls.chip_set_id && t.chipSets.some((c) => c.id === ls.chip_set_id) ? ls.chip_set_id : t.chipSets[0]?.id ?? "");
    if (ls.chips_per_buyin) setChipsPer(ls.chips_per_buyin);
    if (ls.money_per_buyin) setMoneyPer(ls.money_per_buyin);
    const sel = (ls.member_ids?.filter((id) => active.includes(id)) ?? active).slice(0, MAX_PLAYERS);
    setSelected(sel);
    if (ls.cashier_member_id && active.includes(ls.cashier_member_id)) setCashier(ls.cashier_member_id);
    if (ls.food_fee != null) setFoodFee(ls.food_fee);
    rememberedHost.current = ls.host_member_id;
    // the last host again, or whoever opens the night when they play tonight
    setHost(ls.host_member_id && active.includes(ls.host_member_id) ? ls.host_member_id : t.me && sel.includes(t.me.id) ? t.me.id : "");
    setInit(true);
  }, [t.table, t.members, t.chipSets, init, t.me]);

  // opened from an early sign-up: the seated players play, in their seat order
  const [signupId, setSignupId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("signup");
    if (!id || !init) return;
    (async () => {
      const sb = supabase();
      // the night's settings the admin chose on the sign-up
      const { data: su } = await sb.from("signups").select("settings, name").eq("id", id).single();
      if (su?.name) setNightName(su.name);
      const st = (su?.settings ?? null) as SignupSettings | null;
      if (st) {
        if (st.chip_set_id && t.chipSets.some((c) => c.id === st.chip_set_id)) setChipSetId(st.chip_set_id);
        if (st.chips_per_buyin) setChipsPer(st.chips_per_buyin);
        if (st.money_per_buyin) setMoneyPer(st.money_per_buyin);
        if (st.food_fee != null) setFoodFee(st.food_fee);
        if (st.host_member_id) rememberedHost.current = st.host_member_id;
      }
      // the seated players play, in their seat order
      const { data } = await sb.from("signup_seats").select("member_id, seat").eq("signup_id", id).not("seat", "is", null).order("seat");
      if (!data?.length) return;
      setSignupId(id);
      const ids = data.map((r) => r.member_id as string).slice(0, MAX_PLAYERS);
      // the cashier chosen on the sign-up, when they are on the list
      const sc = st?.cashier_member_id;
      setSelected(ids);
      setCashier((c) => (sc && ids.includes(sc) ? sc : ids.includes(c) ? c : ""));
      // the opener was the default host only because they were on the list; keep a remembered host
      setHost((h) => (st?.host_member_id ? st.host_member_id : ids.includes(h) || h === rememberedHost.current ? h : ""));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the screen is ready
  }, [init]);

  if (loading || t.loading || !t.table) return <Spinner />;
  if (!t.isAdmin) {
    router.replace(`/t/${code}`);
    return null;
  }
  if (t.nights.some((n) => n.status === "open")) {
    router.replace(`/t/${code}/n/${t.nights.find((n) => n.status === "open")!.id}`);
    return null;
  }

  const active = t.members.filter((m) => m.status === "active");
  const chipSet = t.chipSets.find((c) => c.id === chipSetId);
  // a poker night is one table: up to 10 players (bigger groups: open a tournament)
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_PLAYERS ? s : [...s, id]));

  async function saveSet(name: string, chips: Chip[]) {
    if (editing && editing !== "new") {
      const { error } = await supabase().from("chip_sets").update({ name, chips }).eq("id", editing.id);
      if (error) throw error;
      await t.reload();
      setChipSetId(editing.id);
    } else {
      const { data, error } = await supabase().from("chip_sets").insert({ table_id: t.table!.id, name, chips }).select().single();
      if (error) throw error;
      await t.reload();
      if (data) setChipSetId(data.id);
    }
    setEditing(null);
  }

  async function addGuest() {
    try {
      const data = await addGuestByName(t.table!.id, guest);
      setGuest("");
      await t.reload();
      setSelected((s) => (s.length >= MAX_PLAYERS || s.includes(data.id) ? s : [...s, data.id]));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function start() {
    setBusy(true);
    setErr(null);
    const sb = supabase();
    // no set yet: the starter set shown on screen becomes the table's set
    let setId = chipSetId;
    if (!setId) {
      const { data: created, error: createErr } = await sb.from("chip_sets").insert({ table_id: t.table!.id, name: "הערכה שלנו", chips: DEFAULT_CHIPS }).select().single();
      if (setErr || !created) {
        setBusy(false);
        return setErr(createErr?.message ?? "שגיאה ביצירת ערכה");
      }
      setId = created.id;
    }
    const { data: night, error } = await sb
      .from("game_nights")
      .insert({
        table_id: t.table!.id,
        name: nightName.trim().slice(0, 60) || null,
        chip_set_id: setId,
        chips_per_buyin: chipsPer,
        money_per_buyin: moneyPer,
        cashier_member_id: cashier || null,
        created_by: user!.id,
        food_fee: foodFee,
        host_member_id: host || null,
      })
      .select()
      .single();
    if (error || !night) {
      setBusy(false);
      return setErr(error?.message ?? "שגיאה");
    }
    // the others confirm their arrival at the table; the cashier and whoever opens the night are there
    const now = new Date().toISOString();
    const here = new Set([cashier, t.me?.id]);
    await sb.from("night_players").insert(selected.map((member_id, seat) => ({ night_id: night.id, member_id, seat, arrived_at: here.has(member_id) ? now : null })));
    await sb
      .from("poker_tables")
      .update({ last_settings: { ...(t.table!.last_settings ?? {}), chip_set_id: setId, chips_per_buyin: chipsPer, money_per_buyin: moneyPer, cashier_member_id: cashier, member_ids: selected, food_fee: foodFee, host_member_id: host || undefined } })
      .eq("id", t.table!.id);
    if (signupId) await sb.from("signups").update({ status: "started", night_id: night.id }).eq("id", signupId);
    await logEvent(night.id, "night_opened", { players: selected.length, chips_per_buyin: chipsPer, money_per_buyin: moneyPer, cashier, food_fee: foodFee, host: host || null });
    router.replace(`/t/${code}/n/${night.id}`);
  }

  const valid = (chipSetId || t.chipSets.length === 0) && chipsPer > 0 && moneyPer > 0 && selected.length >= 2 && cashier && selected.includes(cashier);

  return (
    <>
      <TopBar title="ערב חדש" sub={t.table.name} back={`/t/${code}`} />
      <main className="mx-auto max-w-lg space-y-5 p-4 pb-32">
        {signupId && (
          <Card className="border-gold/40 bg-gold/5 text-sm">
            השחקנים והמקומות נטענו מההרשמה המוקדמת ({selected.length} רשומים). אפשר לשנות לפני הפתיחה.
          </Card>
        )}
        <section>
          <Field label="שם הערב (לא חובה)" hint="נפרד משם השולחן. מופיע בערב ובהיסטוריה.">
            <input className={inputCls} placeholder="השישי ה-13" maxLength={60} value={nightName} onChange={(e) => setNightName(e.target.value)} />
          </Field>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-bold text-muted">ערכת צ'יפים</h2>
          <div className="space-y-2">
            {t.chipSets.length === 0 && (
              <Card className="flex items-center gap-3 border-gold/60 bg-gold/5">
                <div className="min-w-0 flex-1">
                  <div className="font-bold">ערכה התחלתית</div>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {DEFAULT_CHIPS.map((c) => (
                      <span key={c.color} className="num inline-flex items-center gap-1 text-xs text-muted">
                        <ChipDot hex={c.hex} size={14} /> {c.value}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">ככה הערכה תישמר אם לא תשנה. אפשר לערוך צבעים וערכים או ללמד אותה מתמונות.</p>
                </div>
                <Button size="sm" variant="soft" onClick={() => setEditing("new")}>
                  <Pencil className="size-4" /> עריכת הערכה
                </Button>
              </Card>
            )}
            {t.chipSets.map((s) => (
              <Card key={s.id} onClick={() => setChipSetId(s.id)} className={`flex cursor-pointer items-center gap-3 ${chipSetId === s.id ? "border-gold/60 bg-gold/5" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{s.name}</div>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {s.chips.map((c) => (
                      <span key={c.color} className="num inline-flex items-center gap-1 text-xs text-muted">
                        <ChipDot hex={c.hex} size={14} /> {c.value}
                      </span>
                    ))}
                  </div>
                </div>
                {chipSetId === s.id && <Check className="size-5 text-gold" />}
                <button
                  className="grid size-9 place-items-center rounded-xl bg-surface-2 text-muted"
                  aria-label={`עריכת ${s.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(s);
                  }}
                >
                  <Pencil className="size-4" />
                </button>
              </Card>
            ))}
            <div className="flex flex-wrap gap-1">
              {t.chipSets.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setEditing("new")}>
                  <Plus className="size-4" /> החלפנו ערכה? הגדר חדשה
                </Button>
              )}
              <ChipSetImport
                tableId={t.table.id}
                onImported={async (set) => {
                  await t.reload();
                  setChipSetId(set.id);
                }}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-bold text-muted">מחיר כניסה</h2>
          <Card className="grid grid-cols-2 gap-3">
            <Field label="צ'יפים בכניסה">
              <input className={inputCls} inputMode="numeric" value={chipsPer || ""} onChange={(e) => setChipsPer(Number(e.target.value) || 0)} />
            </Field>
            <Field label="עולה (₪)">
              <input className={inputCls} inputMode="decimal" value={moneyPer || ""} onChange={(e) => setMoneyPer(Number(e.target.value) || 0)} />
            </Field>
            <p className="col-span-2 text-xs text-muted">
              כל צ'יפ שווה {chipsPer ? formatMoney(moneyPer / chipsPer) : "—"}. שחקנים יוכלו לבקש לפי צ'יפים או לפי סכום.
            </p>
          </Card>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-bold text-muted">🍽️ דמי אוכל</h2>
          <Card className="grid grid-cols-2 gap-3">
            <Field label="לשחקן (₪)">
              <input className={inputCls} inputMode="decimal" value={foodFee || ""} placeholder="0" onChange={(e) => setFoodFee(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} />
            </Field>
            <Field label="מארח (לא משלם)">
              <select className={inputCls} value={host} onChange={(e) => setHost(e.target.value)}>
                <option value="">בלי מארח</option>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name}</option>
                ))}
              </select>
            </Field>
            <p className="col-span-2 text-xs text-muted">
              {foodFee > 0 && host
                ? `כל שחקן חוץ מהמארח משלם ${formatMoney(foodFee)} למארח. נפרד מהצ'יפים, נכנס רק להתחשבנות בסוף. אפשר לשנות גם במהלך הערב.`
                : foodFee > 0
                  ? "בחר מארח: הוא מקבל את דמי האוכל."
                  : "בלי דמי אוכל הערב."}
            </p>
          </Card>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-bold text-muted">
            מי משחק הערב ({selected.length}/{MAX_PLAYERS}) · <Landmark className="inline size-3.5" /> = קופאי
          </h2>
          {selected.length >= MAX_PLAYERS && (
            <p className="mb-2 px-1 text-xs text-warn">השולחן מלא (עד {MAX_PLAYERS} שחקנים). יותר אנשים? פתחו טורניר עם כמה שולחנות.</p>
          )}
          <Card className="space-y-1 p-2">
            {active.map((m) => {
              const on = selected.includes(m.id);
              return (
                <div key={m.id} className={`flex items-center gap-3 rounded-2xl p-2 ${on ? "" : "opacity-50"}`}>
                  <button onClick={() => toggle(m.id)} className={`grid size-6 shrink-0 place-items-center rounded-lg border ${on ? "border-gold bg-gold text-[#1d1405]" : "border-line"}`}>
                    {on && <Check className="size-4" />}
                  </button>
                  <Avatar name={m.display_name} src={m.avatar_url} size={34} />
                  <span className="min-w-0 flex-1 truncate font-bold" onClick={() => toggle(m.id)}>
                    {m.display_name}
                  </span>
                  <button
                    disabled={!on}
                    onClick={() => setCashier(m.id)}
                    className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold ${cashier === m.id ? "bg-gold text-[#1d1405]" : "bg-surface-2 text-muted"}`}
                  >
                    <Landmark className="size-3.5" /> קופאי
                  </button>
                </div>
              );
            })}
            <div className="flex gap-2 p-2">
              <input className={`${inputCls} h-11`} placeholder="אורח חדש (רק שם)" value={guest} onChange={(e) => setGuest(e.target.value)} onKeyDown={(e) => e.key === "Enter" && guest.trim() && addGuest()} />
              <Button size="md" variant="soft" disabled={!guest.trim()} onClick={addGuest}>
                <UserPlus className="size-4" />
              </Button>
            </div>
          </Card>
        </section>
        {err && <p className="text-sm text-loss">{err}</p>}
      </main>

      <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-lg">
          <Button size="lg" className="w-full" disabled={!valid} loading={busy} onClick={start}>
            פתיחת הערב {chipSet ? `· ${formatMoney(moneyPer)} לכניסה` : ""}
          </Button>
          {!valid && <p className="mt-2 text-center text-xs text-muted">צריך ערכה, מחיר, לפחות 2 שחקנים וקופאי</p>}
        </div>
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== "new" ? "עריכת ערכה" : "ערכת צ'יפים"}>
        {t.table && editing && (
          <ChipSetEditor
            key={editing === "new" ? "new" : editing.id}
            tableId={t.table.id}
            chipSetId={editing === "new" ? undefined : editing.id}
            initial={editing === "new" ? undefined : editing.chips}
            initialName={editing === "new" ? undefined : editing.name}
            onSave={saveSet}
          />
        )}
      </Sheet>
    </>
  );
}
