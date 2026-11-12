"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus, Share2, Mail, Check, X, Crown, Trash2, UserPlus, Copy, CalendarDays, ChevronLeft, Trophy, Flame, TrendingDown, Coins, Spade, Pencil, Link2,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { addGuest as addGuestByName, linkGuest } from "@/lib/guests";
import type { useTable } from "@/lib/hooks";
import type { Member, NightPlayer, Profile, Settlement, PokerTable, ChipSet } from "@/lib/types";
import { formatMoney, formatSigned, memberStats } from "@/lib/calc";
import { Avatar, Badge, Button, Card, ChipDot, Empty, Field, Sheet, inputCls } from "@/components/ui";
import { ChipSetEditor } from "@/components/chip-set-editor";
import { UpcomingSignups } from "@/components/signup-section";
import { TournamentsSection } from "@/components/tournament-section";
import { TournamentStatsView } from "@/components/tournament-stats";

export type Ctx = ReturnType<typeof useTable> & { table: PokerTable; me: Member; userId: string; profile: Profile | null };

/** Admins always see everything; players see everyone's results only if the table allows it. */
export const canSeeAll = (ctx: Pick<Ctx, "isAdmin" | "table">) => ctx.isAdmin || (ctx.table.last_settings?.stats_visibility ?? "all") === "all";

const nameOf = (members: Member[], id: string) => members.find((m) => m.id === id)?.display_name ?? "שחקן";
const dateStr = (s: string) => new Date(s).toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric", year: "2-digit" });

function useTableSettlements(ctx: Ctx) {
  const [rows, setRows] = useState<(Settlement & { game_nights: { started_at: string } })[]>([]);
  const ids = ctx.nights.filter((n) => n.status === "closed").map((n) => n.id).join(",");
  const load = useCallback(async () => {
    if (!ids) return setRows([]);
    const { data } = await supabase().from("settlements").select("*, game_nights(started_at)").in("night_id", ids.split(","));
    setRows((data as never) ?? []);
  }, [ids]);
  useEffect(() => {
    load();
  }, [load]);
  return { rows, reload: load };
}

// ---------------------------------------------------------------------------
// Night tab: live night or start a new one, plus my open debts
// ---------------------------------------------------------------------------
export function NightTab({ ctx }: { ctx: Ctx }) {
  const open = ctx.nights.find((n) => n.status === "open");
  const { rows, reload } = useTableSettlements(ctx);
  const mine = rows.filter((s) => !s.paid && (s.from_member === ctx.me.id || s.to_member === ctx.me.id));

  async function markPaid(id: string) {
    await supabase().from("settlements").update({ paid: true, paid_at: new Date().toISOString() }).eq("id", id);
    reload();
  }

  return (
    <div className="space-y-4">
      {open ? (
        <Link href={`/t/${ctx.table.code}/n/${open.id}`}>
          <div className="felt relative overflow-hidden rounded-[32px] p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-win">
              <span className="size-2 animate-pulse rounded-full bg-win" /> ערב פעיל עכשיו
            </div>
            <div className="mt-2 font-[family-name:var(--font-display)] text-3xl font-extrabold">{dateStr(open.started_at)}</div>
            <div className="mt-1 text-sm text-white/70">
              כניסה: {Number(open.chips_per_buyin).toLocaleString()} צ'יפים = {formatMoney(Number(open.money_per_buyin))}
            </div>
            <div className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-black/30 px-4 py-2 font-bold">
              כניסה לשולחן <ChevronLeft className="size-4" />
            </div>
          </div>
        </Link>
      ) : ctx.isAdmin ? (
        <Card className="text-center">
          <Empty icon={<Spade className="size-7" />} title="אין ערב פעיל" text="פתח ערב חדש: בוחרים שחקנים, ערכת צ'יפים, מחיר כניסה וקופאי.">
            <Link href={`/t/${ctx.table.code}/new-night`}>
              <Button size="lg">
                <Plus className="size-5" /> ערב חדש
              </Button>
            </Link>
          </Empty>
        </Card>
      ) : (
        <Card>
          <Empty icon={<Spade className="size-7" />} title="אין ערב פעיל" text="כשהמנהל יפתח ערב, הוא יופיע כאן." />
        </Card>
      )}

      <UpcomingSignups tableId={ctx.table.id} isAdmin={ctx.isAdmin} />

      <TournamentsSection tableId={ctx.table.id} isAdmin={ctx.isAdmin} lastSettings={ctx.table.last_settings?.tournament} />

      <section>
        <h2 className="mb-2 px-1 text-sm font-bold text-muted">החובות הפתוחים שלי</h2>
        {mine.length === 0 ? (
          <Card className="text-center text-sm text-muted">הכל סגור. אין חובות פתוחים.</Card>
        ) : (
          <div className="space-y-2">
            {mine.map((s) => {
              const iOwe = s.from_member === ctx.me.id;
              const other = nameOf(ctx.members, iOwe ? s.to_member : s.from_member);
              return (
                <Card key={s.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{iOwe ? `אתה חייב ל${other}` : `${other} חייב לך`}</div>
                    <div className="text-xs text-muted">ערב {dateStr(s.game_nights.started_at)}</div>
                  </div>
                  <div className={`num text-lg font-extrabold ${iOwe ? "text-loss" : "text-win"}`}>{formatMoney(Number(s.amount))}</div>
                  {!iOwe && (
                    <Button size="sm" variant="soft" onClick={() => markPaid(s.id)}>
                      <Check className="size-4" /> קיבלתי
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Players tab: members, invites, approvals, removal
// ---------------------------------------------------------------------------
export function PlayersTab({ ctx }: { ctx: Ctx }) {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Member | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [err, setErr] = useState("");
  const active = ctx.members.filter((m) => m.status === "active");
  const pending = ctx.members.filter((m) => m.status === "pending");
  const origin = typeof window !== "undefined" ? location.origin : "";
  const tableLink = `${origin}/join/${ctx.table.code}`;

  const inviteLink = (m: Member) => `${origin}/join/${ctx.table.code}?m=${m.id}`;
  const inviteText = (m: Member) => `היי ${m.display_name}! מצטרפים לשולחן הפוקר "${ctx.table.name}" באפליקציה. נכנסים עם גוגל דרך הקישור: ${inviteLink(m)}`;

  async function addGuest() {
    setBusy(true);
    setErr("");
    try {
      const data = await addGuestByName(ctx.table.id, name);
      setName("");
      setAddOpen(false);
      await ctx.reload();
      setSel(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Signed-in members a guest can be linked to (e.g. the guest joined with the general table link)
  const linkTargets = ctx.members.filter((m) => m.user_id && m.status !== "removed");
  async function link(guest: Member, target: Member) {
    if (!confirm(`לקשר את האורח "${guest.display_name}" לחשבון של ${target.display_name}? כל הערבים, החובות והסטטיסטיקה של האורח יעברו אליו.`)) return;
    setBusy(true);
    setErr("");
    try {
      await linkGuest(guest.id, target.id);
      setLinkOpen(false);
      setSel(null);
      await ctx.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rename(m: Member) {
    const n = prompt("שם האורח", m.display_name)?.trim();
    if (!n || n === m.display_name) return;
    await supabase().from("table_members").update({ display_name: n.slice(0, 40) }).eq("id", m.id);
    await ctx.reload();
    setSel(null);
  }

  async function setStatus(m: Member, patch: Partial<Member>) {
    await supabase().from("table_members").update(patch).eq("id", m.id);
    await ctx.reload();
  }

  async function removeForever(m: Member) {
    const sb = supabase();
    const { count: openDebts } = await sb
      .from("settlements")
      .select("id", { count: "exact", head: true })
      .eq("paid", false)
      .or(`from_member.eq.${m.id},to_member.eq.${m.id}`);
    if (openDebts) return alert(`ל${m.display_name} יש ${openDebts} חובות פתוחים. סגרו אותם לפני מחיקה.`);
    if (!confirm(`למחוק את ${m.display_name} מהשולחן לצמיתות?`)) return;
    const { count: history } = await sb.from("night_players").select("id", { count: "exact", head: true }).eq("member_id", m.id);
    if (history) {
      // keep old nights consistent: hide the player but keep their history
      await sb.from("table_members").update({ status: "removed", role: "player" }).eq("id", m.id);
    } else {
      await sb.from("table_members").delete().eq("id", m.id);
    }
    setSel(null);
    await ctx.reload();
  }

  return (
    <div className="space-y-5">
      <Card className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">קוד השולחן</div>
          <div dir="ltr" className="num text-right font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-[0.3em] text-gold">{ctx.table.code}</div>
        </div>
        <Button
          size="sm"
          variant="soft"
          onClick={async () => {
            await navigator.clipboard?.writeText(tableLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} קישור
        </Button>
        <a href={`https://wa.me/?text=${encodeURIComponent(`הצטרפו לשולחן "${ctx.table.name}": ${tableLink}`)}`} target="_blank" rel="noreferrer">
          <Button size="sm" variant="soft">
            <Share2 className="size-4" />
          </Button>
        </a>
      </Card>

      {ctx.isAdmin && pending.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-bold text-warn">מבקשים להצטרף ({pending.length})</h2>
          <div className="space-y-2">
            {pending.map((m) => (
              <Card key={m.id} className="flex items-center gap-3">
                <Avatar name={m.display_name} src={m.avatar_url} />
                <div className="min-w-0 flex-1 truncate font-bold">{m.display_name}</div>
                <Button size="sm" onClick={() => setStatus(m, { status: "active" })}>
                  <Check className="size-4" /> אישור
                </Button>
                <Button size="sm" variant="danger" onClick={() => supabase().from("table_members").delete().eq("id", m.id).then(() => ctx.reload())}>
                  <X className="size-4" />
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-muted">שחקנים ({active.length})</h2>
          {ctx.isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => { setErr(""); setAddOpen(true); }}>
              <UserPlus className="size-4" /> הוספת אורח
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {active.map((m) => (
            <Card key={m.id} className="flex items-center gap-3 py-3" onClick={() => ctx.isAdmin && setSel(m)}>
              <Avatar name={m.display_name} src={m.avatar_url} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">
                  {m.display_name} {m.id === ctx.me.id && <span className="text-xs text-muted">(אני)</span>}
                </div>
                {!m.user_id && <div className="text-xs text-warn">אורח · עוד לא נרשם לאפליקציה</div>}
              </div>
              {m.role === "admin" && (
                <Badge tone="gold">
                  <Crown className="size-3" /> מנהל
                </Badge>
              )}
            </Card>
          ))}
        </div>
      </section>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="הוספת אורח לפי שם">
        <div className="space-y-4">
          <Field label="שם" hint="אורח לא צריך חשבון גוגל. הוא נשמר בשולחן עם כל הערבים, החובות והסטטיסטיקה. כשירצה להירשם, שלח לו קישור אישי או קשר אותו לחשבון שלו, וכל ההיסטוריה עוברת אליו.">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && addGuest()} autoFocus />
          </Field>
          {err && <p className="text-sm text-loss">{err}</p>}
          <Button className="w-full" disabled={!name.trim()} loading={busy} onClick={addGuest}>
            הוספה
          </Button>
        </div>
      </Sheet>

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.display_name ?? ""}>
        {sel && (
          <div className="space-y-3">
            {!sel.user_id && (
              <>
                <p className="text-sm text-muted">אורח בלי חשבון. כשירצה להירשם, שלח לו הזמנה אישית: מי שנכנס דרך הקישור מקבל את כל ההיסטוריה של האורח.</p>
                <div className="grid grid-cols-2 gap-2">
                  <a href={`https://wa.me/?text=${encodeURIComponent(inviteText(sel))}`} target="_blank" rel="noreferrer">
                    <Button className="w-full">
                      <Share2 className="size-4" /> וואטסאפ
                    </Button>
                  </a>
                  <a href={`mailto:?subject=${encodeURIComponent("הזמנה לשולחן פוקר")}&body=${encodeURIComponent(inviteText(sel))}`}>
                    <Button variant="soft" className="w-full">
                      <Mail className="size-4" /> מייל
                    </Button>
                  </a>
                </div>
              </>
            )}
            {!sel.user_id && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="soft" className="w-full" disabled={busy} onClick={() => { setErr(""); setLinkOpen(true); }}>
                  <Link2 className="size-4" /> קישור לחשבון קיים
                </Button>
                <Button variant="soft" className="w-full" disabled={busy} onClick={() => rename(sel)}>
                  <Pencil className="size-4" /> שינוי שם
                </Button>
              </div>
            )}
            {sel.user_id && sel.id !== ctx.me.id && (
              <Button variant="soft" className="w-full" onClick={() => setStatus(sel, { role: sel.role === "admin" ? "player" : "admin" }).then(() => setSel(null))}>
                <Crown className="size-4" /> {sel.role === "admin" ? "הסרת הרשאת מנהל" : "הפוך למנהל משנה"}
              </Button>
            )}
            {sel.id !== ctx.me.id && sel.user_id !== ctx.table.owner_id && (
              <Button variant="danger" className="w-full" onClick={() => removeForever(sel)}>
                <Trash2 className="size-4" /> מחיקה לצמיתות
              </Button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={linkOpen && !!sel} onClose={() => setLinkOpen(false)} title={`קישור "${sel?.display_name ?? ""}" לחשבון`}>
        <div className="space-y-3">
          <p className="text-sm text-muted">האורח נרשם לאפליקציה? בחר את החשבון שלו. כל הערבים, הטורנירים, החובות והסטטיסטיקה של האורח יעברו אליו, והאורח יימחק מהרשימה.</p>
          {linkTargets.length === 0 ? (
            <p className="text-sm text-muted">אין עדיין שחקנים רשומים לקשר אליהם.</p>
          ) : (
            <div className="max-h-[45dvh] space-y-1 overflow-y-auto">
              {linkTargets.map((m) => (
                <button
                  key={m.id}
                  disabled={busy}
                  onClick={() => sel && link(sel, m)}
                  className="flex w-full items-center gap-3 rounded-2xl p-2 text-right hover:bg-white/5 disabled:opacity-40"
                >
                  <Avatar name={m.display_name} src={m.avatar_url} size={34} />
                  <span className="min-w-0 flex-1 truncate font-bold">{m.display_name}</span>
                  {m.status === "pending" && <span className="text-xs text-warn">מבקש להצטרף</span>}
                  <Link2 className="size-4 text-muted" />
                </button>
              ))}
            </div>
          )}
          {err && <p className="text-sm text-loss">{err}</p>}
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------------
export function HistoryTab({ ctx }: { ctx: Ctx }) {
  const [players, setPlayers] = useState<NightPlayer[]>([]);
  useEffect(() => {
    const ids = ctx.nights.map((n) => n.id);
    if (!ids.length) return;
    supabase().from("night_players").select("*").in("night_id", ids).then(({ data }) => setPlayers(data ?? []));
  }, [ctx.nights]);

  if (!ctx.nights.length) return <Empty icon={<CalendarDays className="size-7" />} title="עוד לא שיחקתם" text="ערבים שנסגרו יופיעו כאן עם סיכום מלא." />;

  return (
    <div className="space-y-2">
      {ctx.nights.map((n) => {
        const ps = players.filter((p) => p.night_id === n.id);
        const pot = ps.reduce((s, p) => s + Number(p.bought_money ?? 0), 0);
        const winner = [...ps].sort((a, b) => Number(b.net ?? 0) - Number(a.net ?? 0))[0];
        return (
          <Link key={n.id} href={`/t/${ctx.table.code}/n/${n.id}`}>
            <Card className="mt-2 flex items-center gap-3">
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-2 text-center leading-none">
                <div>
                  <div className="text-lg font-extrabold">{new Date(n.started_at).getDate()}</div>
                  <div className="text-[10px] text-muted">{new Date(n.started_at).toLocaleDateString("he-IL", { month: "short" })}</div>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {dateStr(n.started_at)} {n.status === "open" && <Badge tone="win">פעיל</Badge>}
                </div>
                <div className="text-xs text-muted">
                  {ps.length} שחקנים{n.status === "closed" && pot > 0 ? ` · קופה ${formatMoney(pot)}` : ""}
                  {canSeeAll(ctx) && winner?.net && Number(winner.net) > 0 ? ` · 🏆 ${nameOf(ctx.members, winner.member_id)}` : ""}
                </div>
              </div>
              <ChevronLeft className="size-5 text-muted" />
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats tab
// ---------------------------------------------------------------------------
export function StatsTab({ ctx }: { ctx: Ctx }) {
  const [kind, setKind] = useState<"cash" | "tournaments">("cash");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 rounded-2xl bg-surface-2 p-1">
        {(
          [
            ["cash", "ערבי פוקר"],
            ["tournaments", "טורנירים"],
          ] as const
        ).map(([v, l]) => (
          <button key={v} onClick={() => setKind(v)} className={`h-10 rounded-xl text-sm font-bold ${kind === v ? "bg-gold text-[#1d1405]" : "text-muted"}`}>
            {l}
          </button>
        ))}
      </div>
      {kind === "cash" ? (
        <CashStats ctx={ctx} />
      ) : (
        <TournamentStatsView tableId={ctx.table.id} members={ctx.members} meId={ctx.me.id} seeAll={canSeeAll(ctx)} />
      )}
    </div>
  );
}

function CashStats({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<NightPlayer[]>([]);
  const closed = useMemo(() => ctx.nights.filter((n) => n.status === "closed"), [ctx.nights]);
  useEffect(() => {
    if (!closed.length) return;
    supabase()
      .from("night_players")
      .select("*")
      .in("night_id", closed.map((n) => n.id))
      .not("net", "is", null)
      .then(({ data }) => setRows(data ?? []));
  }, [closed]);

  const seeAll = canSeeAll(ctx);
  const allStats = useMemo(
    () => memberStats(rows.map((r) => ({ member_id: r.member_id, net: Number(r.net), boughtMoney: Number(r.bought_money ?? 0) }))),
    [rows],
  );

  // cumulative series for my sparkline
  const mySeries = useMemo(() => {
    const order = [...closed].reverse();
    let acc = 0;
    return order
      .map((n) => rows.find((r) => r.night_id === n.id && r.member_id === ctx.me.id))
      .filter(Boolean)
      .map((r) => (acc += Number(r!.net)));
  }, [closed, rows, ctx.me.id]);

  const stats = seeAll ? allStats : allStats.filter((x) => x.member_id === ctx.me.id);
  if (!stats.length) return <Empty icon={<Trophy className="size-7" />} title="אין עדיין נתונים" text="אחרי הערב הסגור הראשון יופיעו כאן דירוג, ממוצעים ושיאים." />;

  const me = stats.find((s) => s.member_id === ctx.me.id);
  const top = stats[0];
  const rebuyKing = [...stats].sort((a, b) => b.buyinsTotal / b.nights - a.buyinsTotal / a.nights)[0];
  const bestNight = [...stats].sort((a, b) => b.best - a.best)[0];
  const totalPot = stats.reduce((s, x) => s + x.buyinsTotal, 0);

  return (
    <div className="space-y-4">
      {me && (
        <Card className="overflow-hidden">
          <div className="text-xs text-muted">הסיכום שלי · {me.nights} ערבים</div>
          <div className={`num mt-1 font-[family-name:var(--font-display)] text-4xl font-extrabold ${me.total >= 0 ? "text-win" : "text-loss"}`}>{formatSigned(me.total)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Mini label="ממוצע לערב" value={formatSigned(me.avg)} />
            <Mini label="ערב הכי טוב" value={formatSigned(me.best)} />
            <Mini label="ניצחונות" value={`${me.wins}/${me.nights}`} />
          </div>
          {mySeries.length > 1 && <Sparkline values={mySeries} />}
        </Card>
      )}

      {!seeAll && <p className="px-1 text-center text-xs text-muted">המנהל הגדיר שכל שחקן רואה רק את הנתונים שלו.</p>}
      {seeAll && <div className="grid grid-cols-3 gap-2">
        <Award icon={<Trophy className="size-4" />} title="מוביל הטבלה" name={nameOf(ctx.members, top.member_id)} value={formatSigned(top.total)} />
        <Award icon={<Flame className="size-4" />} title="ערב השיא" name={nameOf(ctx.members, bestNight.member_id)} value={formatSigned(bestNight.best)} />
        <Award icon={<Coins className="size-4" />} title="מלך הריביי" name={nameOf(ctx.members, rebuyKing.member_id)} value={formatMoney(rebuyKing.buyinsTotal / rebuyKing.nights)} />
      </div>}

      {seeAll && <Card className="p-0">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="font-bold">טבלת השולחן</h2>
          <span className="text-xs text-muted">{closed.length} ערבים · {formatMoney(totalPot)} עברו בקופה</span>
        </div>
        <div className="divide-y divide-line">
          {stats.map((s, i) => (
            <div key={s.member_id} className={`flex items-center gap-3 px-4 py-3 ${s.member_id === ctx.me.id ? "bg-gold/5" : ""}`}>
              <span className={`num w-5 text-center font-extrabold ${i < 3 ? "text-gold" : "text-muted"}`}>{i + 1}</span>
              <Avatar name={nameOf(ctx.members, s.member_id)} src={ctx.members.find((m) => m.id === s.member_id)?.avatar_url} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{nameOf(ctx.members, s.member_id)}</div>
                <div className="num text-[11px] text-muted">
                  {s.nights} ערבים · ממוצע {formatSigned(s.avg)}
                </div>
              </div>
              <div className={`num font-extrabold ${s.total >= 0 ? "text-win" : "text-loss"}`}>{formatSigned(s.total)}</div>
              {s.total < 0 && <TrendingDown className="size-4 text-loss/60" />}
            </div>
          ))}
        </div>
      </Card>}
    </div>
  );
}

function Choice({ label, value, options, onChange, hint }: { label: string; value: string; options: (readonly [string, string])[]; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-muted">{label}</div>
      <div className="grid grid-cols-2 rounded-2xl bg-surface-2 p-1">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)} className={`h-10 rounded-xl text-sm font-bold ${value === v ? "bg-gold text-[#1d1405]" : "text-muted"}`}>
            {l}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-2">
      <div className="num font-bold">{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  );
}

function Award({ icon, title, name, value }: { icon: React.ReactNode; title: string; name: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1 text-[11px] font-bold text-gold">
        {icon} {title}
      </div>
      <div className="mt-1 truncate text-sm font-bold">{name}</div>
      <div className="num text-xs text-muted">{value}</div>
    </Card>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 300;
  const h = 60;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - ((v - min) / span) * h]);
  const zero = h - ((0 - min) / span) * h;
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-16 w-full" preserveAspectRatio="none" style={{ transform: "scaleX(-1)" }}>
      <line x1={0} x2={w} y1={zero} y2={zero} stroke="rgb(255 255 255 / .12)" strokeDasharray="4 4" />
      <polyline fill="none" stroke={last >= 0 ? "var(--color-win)" : "var(--color-loss)"} strokeWidth={2.5} strokeLinejoin="round" points={pts.map((p) => p.join(",")).join(" ")} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Settings tab (admin)
// ---------------------------------------------------------------------------
export function SettingsTab({ ctx }: { ctx: Ctx }) {
  const [name, setName] = useState(ctx.table.name);
  const [editing, setEditing] = useState<ChipSet | "new" | null>(null);
  const [saving, setSaving] = useState(false);

  const ls = ctx.table.last_settings ?? {};
  async function saveSetting(patch: Partial<NonNullable<PokerTable["last_settings"]>>) {
    await supabase().from("poker_tables").update({ last_settings: { ...ls, ...patch } }).eq("id", ctx.table.id);
    ctx.reload();
  }

  async function saveName() {
    await supabase().from("poker_tables").update({ name: name.trim() }).eq("id", ctx.table.id);
    ctx.reload();
  }

  async function saveSet(setName: string, chips: ChipSet["chips"]) {
    setSaving(true);
    if (editing === "new") await supabase().from("chip_sets").insert({ table_id: ctx.table.id, name: setName, chips });
    else if (editing) await supabase().from("chip_sets").update({ name: setName, chips }).eq("id", editing.id);
    setSaving(false);
    setEditing(null);
    ctx.reload();
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <Field label="שם השולחן">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button size="sm" variant="soft" disabled={!name.trim() || name === ctx.table.name} onClick={saveName}>
          שמירה
        </Button>
      </Card>

      <Card className="space-y-4">
        <Choice
          label="מי רואה סטטיסטיקות ותוצאות (ערבים וטורנירים)"
          value={ls.stats_visibility ?? "all"}
          onChange={(v) => saveSetting({ stats_visibility: v as "all" | "own" })}
          options={[
            ["all", "כולם רואים הכל"],
            ["own", "כל אחד רק את שלו"],
          ]}
          hint={(ls.stats_visibility ?? "all") === "own" ? "אתה רואה את כולם, ויכול לשתף את הסיכום בוואטסאפ בסוף הערב." : undefined}
        />
        <Choice
          label="התחשבנות בסוף ערב (ברירת מחדל)"
          value={ls.settle_mode ?? "players"}
          onChange={(v) => saveSetting({ settle_mode: v as "players" | "cashier" })}
          options={[
            ["players", "חלוקה אוטומטית"],
            ["cashier", "הכל דרך הקופאי"],
          ]}
          hint={(ls.settle_mode ?? "players") === "players" ? "מינימום העברות בין השחקנים." : "המפסידים משלמים לקופאי, והקופאי משלם למנצחים. בטורניר: דרך מי שפתח אותו."}
        />
      </Card>

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-muted">ערכות צ'יפים</h2>
          <Button size="sm" variant="ghost" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> ערכה חדשה
          </Button>
        </div>
        {ctx.chipSets.length === 0 ? (
          <Card className="text-center text-sm text-muted">עוד לא הוגדרה ערכה. תוגדר בפתיחת הערב הראשון.</Card>
        ) : (
          <div className="space-y-2">
            {ctx.chipSets.map((s) => (
              <Card key={s.id} className="flex items-center gap-3" onClick={() => setEditing(s)}>
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
                <Pencil className="size-4 text-muted" />
              </Card>
            ))}
          </div>
        )}
      </section>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "ערכה חדשה" : "עריכת ערכה"}>
        {editing && (
          <ChipSetEditor
            tableId={ctx.table.id}
            chipSetId={editing === "new" ? undefined : editing.id}
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? undefined : editing.chips}
            initialName={editing === "new" ? undefined : editing.name}
            onSave={saveSet}
            saving={saving}
          />
        )}
      </Sheet>
    </div>
  );
}
