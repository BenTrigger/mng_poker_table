"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Landmark, Plus, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth, useTable, logEvent } from "@/lib/hooks";
import { TopBar } from "@/components/top-bar";
import { Avatar, Button, Card, ChipDot, Field, Sheet, Spinner, inputCls } from "@/components/ui";
import { ChipSetEditor } from "@/components/chip-set-editor";
import { formatMoney } from "@/lib/calc";
import type { Chip } from "@/lib/types";

const MAX_PLAYERS = 10;

export default function NewNight({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const { user, loading } = useAuth();
  const t = useTable(code, user?.id);

  const [chipSetId, setChipSetId] = useState<string>("");
  const [chipsPer, setChipsPer] = useState(1000);
  const [moneyPer, setMoneyPer] = useState(100);
  const [selected, setSelected] = useState<string[]>([]);
  const [cashier, setCashier] = useState<string>("");
  const [setOpen, setSetOpen] = useState(false);
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
    setSelected((ls.member_ids?.filter((id) => active.includes(id)) ?? active).slice(0, MAX_PLAYERS));
    if (ls.cashier_member_id && active.includes(ls.cashier_member_id)) setCashier(ls.cashier_member_id);
    setInit(true);
  }, [t.table, t.members, t.chipSets, init]);

  // opened from an early sign-up: the seated players play, in their seat order
  const [signupId, setSignupId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("signup");
    if (!id || !init) return;
    supabase()
      .from("signup_seats")
      .select("member_id, seat")
      .eq("signup_id", id)
      .not("seat", "is", null)
      .order("seat")
      .then(({ data }) => {
        if (!data?.length) return;
        setSignupId(id);
        const ids = data.map((r) => r.member_id as string).slice(0, MAX_PLAYERS);
        setSelected(ids);
        setCashier((c) => (ids.includes(c) ? c : ""));
      });
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
    const { data } = await supabase().from("chip_sets").insert({ table_id: t.table!.id, name, chips }).select().single();
    await t.reload();
    if (data) setChipSetId(data.id);
    setSetOpen(false);
  }

  async function addGuest() {
    const { data } = await supabase().from("table_members").insert({ table_id: t.table!.id, display_name: guest.trim() }).select().single();
    setGuest("");
    await t.reload();
    if (data) setSelected((s) => (s.length >= MAX_PLAYERS ? s : [...s, data.id]));
  }

  async function start() {
    setBusy(true);
    setErr(null);
    const sb = supabase();
    const { data: night, error } = await sb
      .from("game_nights")
      .insert({
        table_id: t.table!.id,
        chip_set_id: chipSetId,
        chips_per_buyin: chipsPer,
        money_per_buyin: moneyPer,
        cashier_member_id: cashier || null,
        created_by: user!.id,
      })
      .select()
      .single();
    if (error || !night) {
      setBusy(false);
      return setErr(error?.message ?? "שגיאה");
    }
    await sb.from("night_players").insert(selected.map((member_id, seat) => ({ night_id: night.id, member_id, seat })));
    await sb
      .from("poker_tables")
      .update({ last_settings: { ...(t.table!.last_settings ?? {}), chip_set_id: chipSetId, chips_per_buyin: chipsPer, money_per_buyin: moneyPer, cashier_member_id: cashier, member_ids: selected } })
      .eq("id", t.table!.id);
    if (signupId) await sb.from("signups").update({ status: "started", night_id: night.id }).eq("id", signupId);
    await logEvent(night.id, "night_opened", { players: selected.length, chips_per_buyin: chipsPer, money_per_buyin: moneyPer, cashier });
    router.replace(`/t/${code}/n/${night.id}`);
  }

  const valid = chipSetId && chipsPer > 0 && moneyPer > 0 && selected.length >= 2 && cashier && selected.includes(cashier);

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
          <h2 className="mb-2 px-1 text-sm font-bold text-muted">ערכת צ'יפים</h2>
          <div className="space-y-2">
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
              </Card>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setSetOpen(true)}>
              <Plus className="size-4" /> {t.chipSets.length ? "החלפנו ערכה? הגדר חדשה" : "הגדרת ערכת צ'יפים"}
            </Button>
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
              <input className={`${inputCls} h-11`} placeholder="שחקן חדש (שם)" value={guest} onChange={(e) => setGuest(e.target.value)} />
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

      <Sheet open={setOpen} onClose={() => setSetOpen(false)} title="ערכת צ'יפים חדשה">
        <ChipSetEditor onSave={saveSet} />
      </Sheet>
    </>
  );
}
