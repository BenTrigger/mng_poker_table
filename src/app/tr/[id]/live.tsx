"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, Skull, Repeat, PlusCircle, ArrowLeftRight, Shuffle, Flag, UserPlus, Undo2, Coffee, Lock, LockOpen } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import {
  anchorFor, balanceMoves, rebuyLabel, rebuyOpenAt, blindsLabel, chipsInPlay, mmss, prizePool, prizes, standings, togglePause, type ClockState,
} from "@/lib/tournament";
import { formatMoney } from "@/lib/calc";
import { PokerTable, type Seat } from "@/components/poker-table";
import { Avatar, Badge, Button, Card, Sheet, inputCls } from "@/components/ui";
import type { Tournament, TournamentEntryView } from "@/lib/types";
import type { RunFn } from "./page";

/** Short beep and a vibration when the level changes */
function alertLevel() {
  try {
    navigator.vibrate?.([200, 100, 200]);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch {
    // no audio on this device
  }
}

export function LiveView({
  t, entries, clock, now, isAdmin, myId, busy, run, onAdd,
}: {
  t: Tournament;
  entries: TournamentEntryView[];
  clock: ClockState;
  now: number;
  isAdmin: boolean;
  myId: string | null;
  busy: boolean;
  run: RunFn;
  onAdd: () => void;
}) {
  const [sel, setSel] = useState<TournamentEntryView | null>(null);
  const [finishing, setFinishing] = useState(false);
  const playing = entries.filter((e) => e.status === "playing");
  const busted = entries.filter((e) => e.status === "busted");
  const waiting = entries.filter((e) => e.status === "waiting").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const played = [...playing, ...busted];
  const pool = prizePool(t, played);
  const avg = playing.length ? Math.round(chipsInPlay(t, played) / playing.length) : 0;
  const pays = prizes(pool, played.length);
  const order = standings(entries);
  const rebuyOpen = rebuyOpenAt(t, clock.levelNo, now);
  const moves = useMemo(() => balanceMoves(entries, t.table_count, t.seats_per_table), [entries, t.table_count, t.seats_per_table]);
  const name = (id: string | null) => entries.find((e) => e.id === id || e.member_id === id)?.display_name ?? "";

  // beep on level change (not on the first render)
  const prev = useRef(clock.index);
  useEffect(() => {
    if (prev.current !== clock.index && !clock.paused) alertLevel();
    prev.current = clock.index;
  }, [clock.index, clock.paused]);

  // late registration closes by itself after its last level (done by the admin's phone)
  useEffect(() => {
    if (isAdmin && t.registration_open && t.late_reg_until_level > 0 && clock.levelNo > t.late_reg_until_level) {
      supabase().from("tournaments").update({ registration_open: false }).eq("id", t.id).then(() => undefined);
    }
  }, [isAdmin, t.registration_open, t.late_reg_until_level, clock.levelNo, t.id]);

  const setClock = (patch: Record<string, unknown>) => run("clock", () => supabase().from("tournaments").update(patch).eq("id", t.id));
  const pct = Math.min(100, (clock.elapsedMs / (clock.level.minutes * 60_000)) * 100);

  async function applyMoves() {
    // free the seats first, then seat everyone in their new place
    const sb = supabase();
    for (const m of moves) await sb.from("tournament_entries").update({ table_no: null, seat_no: null }).eq("id", m.entry_id);
    await run("move", async () => {
      for (const m of moves) {
        const { error } = await sb.from("tournament_entries").update({ table_no: m.to_table, seat_no: m.to_seat }).eq("id", m.entry_id);
        if (error) return { error };
      }
      return { error: null };
    }, "השולחנות אוזנו");
  }

  const tables = Array.from({ length: t.table_count }, (_, i) => i + 1)
    .map((n) => ({ n, list: playing.filter((e) => e.table_no === n) }))
    .filter((x) => x.list.length > 0);

  return (
    <div className="space-y-4">
      {/* clock */}
      <div className="felt relative overflow-hidden rounded-[32px] p-5 text-center">
        <div className="flex items-center justify-between text-xs font-bold text-white/70">
          <span>{clock.level.break ? "הפסקה" : `שלב ${clock.levelNo}`}</span>
          {clock.paused ? <Badge tone="warn">השעון עצור</Badge> : <span className="inline-flex items-center gap-1 text-win"><span className="size-2 animate-pulse rounded-full bg-win" /> רץ</span>}
        </div>
        {clock.level.break ? (
          <div className="mt-2 flex items-center justify-center gap-2 font-[family-name:var(--font-display)] text-4xl font-extrabold text-white">
            <Coffee className="size-8" /> הפסקה
          </div>
        ) : (
          <div className="num mt-2 font-[family-name:var(--font-display)] text-5xl font-extrabold text-white">
            {clock.level.sb!.toLocaleString()}/{clock.level.bb!.toLocaleString()}
          </div>
        )}
        {!!clock.level.ante && <div className="num text-sm text-white/70">אנטה {clock.level.ante.toLocaleString()}</div>}
        <div className={`num mt-3 font-[family-name:var(--font-display)] text-6xl font-extrabold ${clock.remainingMs < 60_000 ? "text-loss" : "gold-text"}`}>
          {mmss(clock.remainingMs)}
        </div>
        <div className="mx-auto mt-3 h-1.5 max-w-xs overflow-hidden rounded-full bg-black/30">
          <div className="h-full rounded-full bg-gold transition-[width] duration-1000" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 text-xs text-white/70">הבא: {clock.next ? blindsLabel(clock.next) : "השלב האחרון"}</div>
        {isAdmin && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              className="grid size-11 place-items-center rounded-full bg-black/30 text-white disabled:opacity-30"
              disabled={busy || clock.index === 0}
              onClick={() => setClock({ clock_anchor: anchorFor(t, clock.index - 1, now) })}
              aria-label="שלב קודם"
            >
              <SkipForward className="size-5" />
            </button>
            <button className="grid size-14 place-items-center rounded-full bg-gold text-[#1d1405]" disabled={busy} onClick={() => setClock(togglePause(t, Date.now()))} aria-label={clock.paused ? "המשך" : "עצירה"}>
              {clock.paused ? <Play className="size-6" /> : <Pause className="size-6" />}
            </button>
            <button
              className="grid size-11 place-items-center rounded-full bg-black/30 text-white disabled:opacity-30"
              disabled={busy || !clock.next}
              onClick={() => setClock({ clock_anchor: anchorFor(t, clock.index + 1, now) })}
              aria-label="שלב הבא"
            >
              <SkipBack className="size-5" />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="נשארו" value={`${playing.length}/${played.length}`} />
        <Stat label="ערימה ממוצעת" value={avg.toLocaleString()} sub={!clock.level.break && clock.level.bb ? `${Math.round(avg / clock.level.bb)} BB` : undefined} />
        <Stat label="קופת פרסים" value={formatMoney(pool)} />
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {rebuyOpen && <Badge tone="win">{rebuyLabel(t)}</Badge>}
        {t.registration_open && <Badge tone="win">הרשמה מאוחרת פתוחה{t.late_reg_until_level ? ` עד סוף שלב ${t.late_reg_until_level}` : ""}</Badge>}
      </div>

      {isAdmin && moves.length > 0 && (
        <Card className="space-y-2 border-warn/40 bg-warn/5">
          <div className="flex items-center gap-2 font-bold text-warn">
            <Shuffle className="size-4" /> {moves.some((m) => m.reason === "break") ? "אפשר לשבור שולחן" : "צריך לאזן שולחנות"}
          </div>
          {moves.map((m) => (
            <div key={m.entry_id} className="text-sm">
              <b>{name(m.entry_id)}</b> עובר משולחן {m.from_table} לשולחן {m.to_table}, כיסא {m.to_seat}
            </div>
          ))}
          <Button size="sm" className="w-full" disabled={busy} onClick={applyMoves}>
            <ArrowLeftRight className="size-4" /> להעביר
          </Button>
        </Card>
      )}

      {tables.map(({ n, list }) => {
        const seats: Seat[] = Array.from({ length: t.seats_per_table }, (_, i) => {
          const e = list.find((x) => x.seat_no === i + 1);
          return e
            ? {
                id: e.id,
                name: e.display_name,
                avatar: e.avatar_url,
                amount: `#${i + 1}`,
                sub: e.rebuys ? `ריביי ×${e.rebuys}` : undefined,
                tone: e.member_id === myId ? "gold" : "muted",
                isMe: e.member_id === myId,
              }
            : { id: `empty-${n}-${i}`, name: "—", amount: `#${i + 1}`, tone: "muted", empty: true };
        });
        return (
          <section key={n}>
            <h2 className="px-1 text-sm font-bold text-muted">
              {tables.length === 1 && played.length > t.seats_per_table ? "שולחן הגמר" : `שולחן ${n}`} · {list.length} שחקנים
            </h2>
            <PokerTable
              seats={seats}
              onSeat={(id) => {
                const e = list.find((x) => x.id === id);
                if (e && isAdmin) setSel(e);
              }}
              center={
                <div>
                  <div className="font-[family-name:var(--font-display)] text-3xl font-extrabold text-white">{n}</div>
                  <div className="text-[11px] text-white/60">{isAdmin ? "לחץ על שחקן לניהול" : "שולחן"}</div>
                </div>
              }
            />
          </section>
        );
      })}

      {busted.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-bold text-muted">יצאו ({busted.length})</h2>
          <Card className="space-y-2 p-3">
            {order
              .map((id, i) => ({ e: entries.find((x) => x.id === id)!, place: i + 1 }))
              .filter(({ e }) => e.status === "busted")
              .map(({ e, place }) => (
                <button key={e.id} disabled={!isAdmin} onClick={() => setSel(e)} className="flex w-full items-center gap-3 text-right">
                  <span className="num w-7 text-center text-sm font-bold text-muted">{place}</span>
                  <Avatar name={e.display_name} src={e.avatar_url} size={30} />
                  <span className="min-w-0 flex-1 truncate font-bold">{e.display_name}</span>
                  {e.busted_by && <span className="truncate text-xs text-muted">ע"י {name(e.busted_by)}</span>}
                  {pays[place - 1] ? <Badge tone="gold">{formatMoney(pays[place - 1])}</Badge> : null}
                </button>
              ))}
          </Card>
        </section>
      )}

      {isAdmin && waiting.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-bold text-muted">ממתינים לכיסא ({waiting.length})</h2>
          <Card className="space-y-2 p-3">
            {waiting.map((e, i) => (
              <div key={e.id} className="flex items-center gap-3">
                <Avatar name={e.display_name} src={e.avatar_url} size={30} />
                <span className="min-w-0 flex-1 truncate font-bold">{e.display_name}</span>
                {i === 0 && playing.length < t.table_count * t.seats_per_table && (
                  <Button
                    size="sm"
                    variant="soft"
                    disabled={busy}
                    onClick={() => run("seat", () => supabase().rpc("admin_tournament_entry", { p_id: t.id, p_member: e.member_id, p_add: true }), `${e.display_name} נכנס`)}
                  >
                    <UserPlus className="size-4" /> להושיב
                  </Button>
                )}
              </div>
            ))}
            <p className="text-xs text-muted">מי שיצא וקונה ריביי מקבל קדימות על הכיסא.</p>
          </Card>
        </section>
      )}

      <section>
        <h2 className="mb-2 px-1 text-sm font-bold text-muted">פרסים ({played.length} שחקנים)</h2>
        <Card className="grid grid-cols-3 gap-2 p-3 text-center">
          {pays.map((p, i) => (
            <div key={i} className="rounded-2xl bg-surface-2 p-2">
              <div className="text-lg">{["🥇", "🥈", "🥉"][i] ?? `${i + 1}`}</div>
              <div className="num font-extrabold">{formatMoney(p)}</div>
            </div>
          ))}
        </Card>
      </section>

      {isAdmin && (
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-bold text-muted">ניהול</h2>
          <Card className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="soft" onClick={onAdd}>
                <UserPlus className="size-4" /> כניסה מאוחרת
              </Button>
              <Button variant="soft" disabled={busy} onClick={() => run("reg", () => supabase().from("tournaments").update({ registration_open: !t.registration_open }).eq("id", t.id))}>
                {t.registration_open ? <Lock className="size-4" /> : <LockOpen className="size-4" />} {t.registration_open ? "סגירת הרשמה" : "פתיחת הרשמה"}
              </Button>
            </div>
            <Button className="w-full" size="lg" variant={playing.length === 1 ? "gold" : "soft"} onClick={() => setFinishing(true)}>
              <Flag className="size-5" /> {playing.length === 1 ? "יש מנצח! סיום הטורניר" : "סיום / דיל"}
            </Button>
          </Card>
        </section>
      )}

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.display_name ?? ""}>
        {sel && (
          <PlayerSheet
            key={sel.id}
            t={t}
            e={entries.find((x) => x.id === sel.id) ?? sel}
            entries={entries}
            rebuyOpen={rebuyOpen}
            canUndo={sel.status === "busted" && order.indexOf(sel.id) === playing.length}
            busy={busy}
            run={run}
            close={() => setSel(null)}
          />
        )}
      </Sheet>

      <Sheet open={finishing} onClose={() => setFinishing(false)} title="סיום הטורניר">
        {finishing && <FinishSheet t={t} entries={entries} pool={pool} pays={pays} order={order} busy={busy} run={run} close={() => setFinishing(false)} />}
      </Sheet>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <div className="num text-lg font-extrabold">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
      {sub && <div className="num text-[10px] text-gold">{sub}</div>}
    </Card>
  );
}

function PlayerSheet({
  t, e, entries, rebuyOpen, canUndo, busy, run, close,
}: {
  t: Tournament;
  e: TournamentEntryView;
  entries: TournamentEntryView[];
  rebuyOpen: boolean;
  canUndo: boolean;
  busy: boolean;
  run: RunFn;
  close: () => void;
}) {
  const [by, setBy] = useState<string>("");
  const [moveTo, setMoveTo] = useState<string>("");
  const others = entries.filter((x) => x.status === "playing" && x.id !== e.id);
  const free: { table: number; seat: number }[] = [];
  for (let tb = 1; tb <= t.table_count; tb++)
    for (let s = 1; s <= t.seats_per_table; s++)
      if (!entries.some((x) => x.status === "playing" && x.table_no === tb && x.seat_no === s)) free.push({ table: tb, seat: s });

  const sb = supabase();
  const act = async (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    if (await run(key, fn, ok)) close();
  };

  if (e.status === "busted") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{e.display_name} בחוץ.</p>
        {rebuyOpen && (
          <Button className="w-full" disabled={busy} onClick={() => act("rebuy", () => sb.rpc("reenter_player", { p_entry: e.id, p_rebuy: true }), `ריביי ל${e.display_name}`)}>
            <Repeat className="size-4" /> ריביי ({formatMoney(Number(t.rebuy_price ?? t.buy_in))})
          </Button>
        )}
        {canUndo && (
          <Button variant="soft" className="w-full" disabled={busy} onClick={() => act("undo", () => sb.rpc("reenter_player", { p_entry: e.id, p_rebuy: false }), "ההדחה בוטלה")}>
            <Undo2 className="size-4" /> טעות, הוא עדיין משחק
          </Button>
        )}
        {!rebuyOpen && !canUndo && <p className="text-xs text-muted">תקופת הריביי נגמרה.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={e.display_name} src={e.avatar_url} size={48} />
        <div className="text-sm text-muted">
          שולחן {e.table_no}, כיסא {e.seat_no}
          {e.rebuys > 0 && ` · ${e.rebuys} ריביי`}
          {e.addon && " · אד-און"}
        </div>
      </div>

      <section className="space-y-2">
        <label className="block text-sm font-bold text-muted">מי הוציא אותו? (לא חובה)</label>
        <select className={inputCls} value={by} onChange={(x) => setBy(x.target.value)}>
          <option value="">—</option>
          {others.map((o) => (
            <option key={o.id} value={o.member_id}>
              {o.display_name}
            </option>
          ))}
        </select>
        <Button variant="danger" className="w-full" disabled={busy} onClick={() => act("bust", () => sb.rpc("bust_player", { p_entry: e.id, p_by: by || null }), `${e.display_name} בחוץ`)}>
          <Skull className="size-4" /> יצא מהטורניר
        </Button>
      </section>

      {t.addon_price != null && !e.addon && (
        <Button variant="soft" className="w-full" disabled={busy} onClick={() => act("addon", () => sb.from("tournament_entries").update({ addon: true }).eq("id", e.id), "אד-און נרשם")}>
          <PlusCircle className="size-4" /> אד-און ({formatMoney(Number(t.addon_price))} · {Number(t.addon_chips ?? 0).toLocaleString()} צ'יפים)
        </Button>
      )}
      {e.addon && (
        <Button variant="ghost" size="sm" className="w-full" disabled={busy} onClick={() => act("addon", () => sb.from("tournament_entries").update({ addon: false }).eq("id", e.id), "האד-און בוטל")}>
          ביטול אד-און
        </Button>
      )}

      {free.length > 0 && (
        <section className="space-y-2">
          <label className="block text-sm font-bold text-muted">העברה לכיסא אחר</label>
          <div className="flex gap-2">
            <select className={inputCls} value={moveTo} onChange={(x) => setMoveTo(x.target.value)}>
              <option value="">בחר כיסא פנוי</option>
              {free.map((f) => (
                <option key={`${f.table}-${f.seat}`} value={`${f.table}-${f.seat}`}>
                  שולחן {f.table}, כיסא {f.seat}
                </option>
              ))}
            </select>
            <Button
              variant="soft"
              disabled={busy || !moveTo}
              onClick={() => {
                const [table_no, seat_no] = moveTo.split("-").map(Number);
                act("move", () => sb.from("tournament_entries").update({ table_no, seat_no }).eq("id", e.id), "הועבר");
              }}
            >
              <ArrowLeftRight className="size-4" />
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function FinishSheet({
  t, entries, pool, pays, order, busy, run, close,
}: {
  t: Tournament;
  entries: TournamentEntryView[];
  pool: number;
  pays: number[];
  order: string[];
  busy: boolean;
  run: RunFn;
  close: () => void;
}) {
  const alive = entries.filter((e) => e.status === "playing").length;
  const [amounts, setAmounts] = useState<number[]>(() => order.map((_, i) => pays[i] ?? 0));
  const [ranking, setRanking] = useState<string[]>(order);
  const total = amounts.reduce((a, b) => a + (b || 0), 0);
  const ok = Math.abs(total - pool) < 0.01;
  const byId = (id: string) => entries.find((e) => e.id === id)!;

  // players still in can be put in their final order (and amounts typed for a deal)
  const swap = (i: number) => setRanking((r) => r.map((x, j) => (j === i ? r[i + 1] : j === i + 1 ? r[i] : x)));

  async function finish() {
    const p = ranking.map((id, i) => ({ entry_id: id, place: i + 1, prize: amounts[i] || 0 }));
    if (await run("finish", () => supabase().rpc("finish_tournament", { p_id: t.id, p_prizes: p }), "הטורניר הסתיים 🏆")) close();
  }

  return (
    <div className="space-y-3">
      {alive > 1 && (
        <p className="text-sm text-muted">
          עדיין משחקים {alive}. סוגרים דיל? סדרו את המקומות בחצים והקלידו כמה כל אחד מקבל. הסכום צריך להיות בדיוק הקופה.
        </p>
      )}
      <div className="space-y-1.5">
        {ranking.map((id, i) => {
          const e = byId(id);
          const movable = i < alive - 1;
          return (
            <div key={id} className="flex items-center gap-2">
              <span className="num w-6 text-center font-bold text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-bold">{e.display_name}</span>
              {movable && (
                <button className="rounded-lg bg-surface-2 px-2 py-1 text-xs" onClick={() => swap(i)} aria-label="החלפה עם הבא">
                  ⇅
                </button>
              )}
              <input
                className={`${inputCls} h-10 w-24 text-center`}
                inputMode="decimal"
                value={amounts[i] || ""}
                placeholder="0"
                onChange={(x) => setAmounts((a) => a.map((v, j) => (j === i ? Number(x.target.value) || 0 : v)))}
              />
            </div>
          );
        })}
      </div>
      <div className={`num text-center text-sm font-bold ${ok ? "text-win" : "text-loss"}`}>
        {formatMoney(total)} מתוך {formatMoney(pool)}
      </div>
      <Button className="w-full" size="lg" disabled={!ok || busy} onClick={finish}>
        <Flag className="size-5" /> סיום וחישוב מי מעביר למי
      </Button>
    </div>
  );
}
