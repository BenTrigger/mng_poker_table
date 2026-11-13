"use client";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { Landmark, HandCoins, ListChecks, Users, AlertTriangle, Activity, Hand, Check } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth, useNight, useTable } from "@/lib/hooks";
import { chipRate, formatMoney, formatSigned, playerLines } from "@/lib/calc";
import { TopBar } from "@/components/top-bar";
import { PokerTable, type Seat } from "@/components/poker-table";
import { Avatar, Badge, Button, Card, Spinner, Toast } from "@/components/ui";
import { RequestSheet, CashierSheet, PlayerSheet, CloseSheet, AdminSheet, Summary, EventFeed } from "./sheets";
import { HandoverSheet } from "./handover";

export default function NightPage({ params }: { params: Promise<{ code: string; nightId: string }> }) {
  const { code, nightId } = use(params);
  const { user, loading } = useAuth();
  const t = useTable(code, user?.id);
  const n = useNight(nightId, !!t.me && t.me.status === "active");
  const [sheet, setSheet] = useState<null | "request" | "cashier" | "close" | "admin" | "handover" | { player: string }>(null);
  const [toast, setToast] = useState<string | null>(null);
  // a player opened from the close sheet goes back to it (its counts are kept)
  const [backToClose, setBackToClose] = useState(false);
  const [requestFor, setRequestFor] = useState<string | null>(null); // admin/cashier asked for chips on a player's behalf
  const [showFeed, setShowFeed] = useState(false);

  const night = n.night;
  const lines = useMemo(() => (night ? playerLines(night, n.players, n.requests) : []), [night, n.players, n.requests]);
  const chipSet = t.chipSets.find((c) => c.id === night?.chip_set_id) ?? null;
  const me = t.me;
  const isCashier = !!me && night?.cashier_member_id === me.id;
  const canManage = t.isAdmin || isCashier;
  const pending = n.requests.filter((r) => r.status === "pending");
  const flagged = n.requests.filter((r) => r.status === "flagged");
  const myLine = lines.find((l) => l.member_id === me?.id);
  const open = night?.status === "open";
  const waitingFor = n.players.filter((p) => p.status === "playing" && !p.arrived_at);
  const myPlayer = n.players.find((p) => p.member_id === me?.id);
  const iAmExpected = open && myPlayer?.status === "playing" && !myPlayer.arrived_at;
  const [arriving, setArriving] = useState<string | null>(null);

  // a later toast is not cut short by an earlier one's timer
  function flash(text: string) {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 2500);
  }

  async function markArrived(playerId: string) {
    setArriving(playerId);
    const { error } = await supabase().rpc("set_arrived", { p_player: playerId, p_arrived: true });
    setArriving(null);
    if (error) {
      flash("לא הצלחתי לסמן הגעה, נסה שוב");
    } else n.reload();
  }

  // tell the admin and the cashier when someone arrives
  const prevWaiting = useRef<number | null>(null);
  useEffect(() => {
    if (prevWaiting.current != null && waitingFor.length < prevWaiting.current && canManage && open) {
      flash("שחקן אישר הגעה");
    }
    prevWaiting.current = waitingFor.length;
  }, [waitingFor.length, canManage, open]);

  // buzz the cashier when a new request arrives
  const prevPending = useRef<number | null>(null);
  useEffect(() => {
    if (prevPending.current != null && pending.length > prevPending.current && canManage) {
      const r = pending[pending.length - 1];
      setToast(`בקשה חדשה: ${t.members.find((m) => m.id === r.member_id)?.display_name ?? ""} · ${Number(r.chips).toLocaleString()} צ'יפים`);
      navigator.vibrate?.([80, 40, 80]);
      setTimeout(() => setToast(null), 3000);
    }
    prevPending.current = pending.length;
  }, [pending, canManage, t.members]);

  if (loading || t.loading || n.loading) return <Spinner />;
  if (!night || !me) return <Spinner />;

  const rate = chipRate(night);
  const seeAll = t.isAdmin || (t.table?.last_settings?.stats_visibility ?? "all") === "all";
  const closed = night.status === "closed";
  const totalBought = lines.reduce((s, l) => s + l.boughtMoney, 0);
  const nameOf = (id: string) => t.members.find((m) => m.id === id)?.display_name ?? "שחקן";
  const cashierName = night.cashier_member_id ? nameOf(night.cashier_member_id) : "—";

  const seats: Seat[] = n.players.map((p) => {
    const l = lines.find((x) => x.member_id === p.member_id)!;
    const m = t.members.find((x) => x.id === p.member_id);
    const net = closed ? Number(p.net ?? l.net ?? 0) : l.net;
    const showNet = (closed || p.status === "out") && (seeAll || p.member_id === me.id);
    const away = !closed && p.status === "playing" && !p.arrived_at;
    return {
      id: p.member_id,
      name: m?.display_name ?? "שחקן",
      avatar: m?.avatar_url,
      amount: showNet ? formatSigned(net) : formatMoney(l.boughtMoney),
      sub: showNet ? (closed ? undefined : "יצא") : away ? "טרם הגיע" : l.buyins ? `${+l.buyins.toFixed(1)} כניסות` : "טרם קנה",
      tone: showNet ? ((net ?? 0) >= 0 ? "win" : "loss") : l.boughtMoney ? "gold" : "muted",
      isCashier: p.member_id === night.cashier_member_id,
      isMe: p.member_id === me.id,
      pending: l.pendingChips > 0,
      out: (p.status === "out" && !closed) || away,
    };
  });

  const dateStr = new Date(night.started_at).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" });

  return (
    <>
      <Toast text={toast} />
      <TopBar
        title={closed ? `סיכום ערב · ${dateStr}` : `ערב ${dateStr}`}
        sub={`${Number(night.chips_per_buyin).toLocaleString()} צ'יפים = ${formatMoney(Number(night.money_per_buyin))} · קופאי: ${cashierName}`}
        back={`/t/${code}`}
        right={
          t.isAdmin && !closed ? (
            <button className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-bold" onClick={() => setSheet("admin")} aria-label="ניהול הערב">
              <Users className="size-4" /> שחקנים וקופאי
            </button>
          ) : undefined
        }
      />

      <main className="mx-auto max-w-lg px-3 pb-40 pt-2">
        <PokerTable
          seats={seats}
          onSeat={(id) => setSheet({ player: id })}
          center={
            <div>
              <div className="text-[11px] font-bold tracking-wide text-white/60">{closed ? "סה\"כ קופה" : "בקופה"}</div>
              <div className="num font-[family-name:var(--font-display)] text-3xl font-extrabold text-white drop-shadow">{formatMoney(totalBought)}</div>
              <div className="num mt-0.5 text-[11px] text-white/60">{Math.round(totalBought / (rate || 1)).toLocaleString()} צ'יפים</div>
              {!closed && pending.length > 0 && (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-bold text-gold">
                  <HandCoins className="size-3.5" /> {pending.length} ממתינים לקופאי
                </div>
              )}
            </div>
          }
        />

        {closed ? (
          <Summary night={night} players={n.players} lines={lines} settlements={n.settlements} members={t.members} meId={me.id} isAdmin={t.isAdmin} reload={n.reload} seeAll={seeAll} requests={n.requests} table={t.table} onPlayer={(id) => setSheet({ player: id })} />
        ) : (
          <>
            {t.isAdmin && flagged.length > 0 && (
              <button onClick={() => setSheet("cashier")} className="mb-3 flex w-full items-center gap-3 rounded-3xl border border-warn/40 bg-warn/10 p-4 text-right">
                <AlertTriangle className="size-6 shrink-0 text-warn" />
                <div className="flex-1">
                  <div className="font-bold text-warn">{flagged.length} מסירות לא תואמות</div>
                  <div className="text-xs text-muted">הספירה בתמונה לא תאמה לבקשה. צריך את האישור שלך.</div>
                </div>
              </button>
            )}

            {iAmExpected && myPlayer && (
              <Card className="mb-3 space-y-3 border-gold/50 bg-gold/5 text-center">
                <div>
                  <div className="font-bold">הגעת לשולחן?</div>
                  <div className="text-xs text-muted">אשר הגעה, ואז אפשר לבקש צ&apos;יפים מהקופאי.</div>
                </div>
                <Button size="lg" className="w-full" loading={arriving === myPlayer.id} onClick={() => markArrived(myPlayer.id)}>
                  <Hand className="size-5" /> הגעתי
                </Button>
              </Card>
            )}

            {canManage && waitingFor.length > 0 && (
              <Card className="mb-3 p-0">
                <div className="px-4 pb-1 pt-4">
                  <h2 className="font-bold">
                    מי עוד לא הגיע ({waitingFor.length} מתוך {n.players.filter((p) => p.status === "playing").length})
                  </h2>
                  <p className="text-xs text-muted">שחקן מאשר בטלפון שלו, או שאתה מסמן כאן כשהוא מגיע.</p>
                </div>
                <div className="divide-y divide-line">
                  {waitingFor.map((p) => {
                    const m = t.members.find((x) => x.id === p.member_id);
                    return (
                      <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                        <Avatar name={m?.display_name ?? ""} src={m?.avatar_url} size={34} />
                        <span className="min-w-0 flex-1 truncate text-sm font-bold">{m?.display_name ?? "שחקן"}</span>
                        <Button size="sm" variant="soft" loading={arriving === p.id} disabled={!!arriving} onClick={() => markArrived(p.id)} aria-label={`${m?.display_name ?? ""} הגיע`}>
                          <Check className="size-4" /> הגיע
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {myLine && myLine.status === "playing" && !iAmExpected && (
              <Card className="mb-3 flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-xs text-muted">אני בערב הזה</div>
                  <div className="num text-xl font-extrabold">{formatMoney(myLine.boughtMoney)}</div>
                </div>
                {myLine.pendingChips > 0 && <Badge tone="warn">ממתין {myLine.pendingChips.toLocaleString()}</Badge>}
              </Card>
            )}

            {/* who bought how much */}
            <Card className="p-0">
              <div className="flex items-center justify-between px-4 pb-1 pt-4">
                <h2 className="font-bold">מי קנה ובכמה</h2>
                <button className="flex items-center gap-1 text-xs text-muted" onClick={() => setShowFeed((s) => !s)}>
                  <Activity className="size-3.5" /> {showFeed ? "הסתר יומן" : "יומן פעולות"}
                </button>
              </div>
              <div className="divide-y divide-line">
                {[...lines]
                  .sort((a, b) => b.boughtMoney - a.boughtMoney)
                  .map((l) => {
                    const m = t.members.find((x) => x.id === l.member_id);
                    const max = Math.max(...lines.map((x) => x.boughtMoney), 1);
                    return (
                      <button key={l.member_id} onClick={() => setSheet({ player: l.member_id })} className="flex w-full items-center gap-3 px-4 py-3 text-right">
                        <Avatar name={m?.display_name ?? ""} src={m?.avatar_url} size={34} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-bold">
                            <span className="truncate">{m?.display_name}</span>
                            {l.member_id === night.cashier_member_id && <Landmark className="size-3.5 text-gold" />}
                            {l.status === "out" && <Badge>יצא · {formatSigned(l.net)}</Badge>}
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                            <div className="h-full rounded-full bg-gradient-to-l from-[#ffd77a] to-gold-2" style={{ width: `${(l.boughtMoney / max) * 100}%` }} />
                          </div>
                        </div>
                        <div className="text-left">
                          <div className="num font-extrabold">{formatMoney(l.boughtMoney)}</div>
                          <div className="num text-[11px] text-muted">{l.boughtChips.toLocaleString()} צ'יפים</div>
                        </div>
                      </button>
                    );
                  })}
              </div>
              {showFeed && <EventFeed events={n.events} members={t.members} />}
            </Card>
          </>
        )}
      </main>

      {!closed && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-lg gap-2">
            {iAmExpected && !canManage && myPlayer ? (
              <Button size="lg" className="flex-1" loading={arriving === myPlayer.id} onClick={() => markArrived(myPlayer.id)}>
                <Hand className="size-5" /> הגעתי
              </Button>
            ) : (myLine?.status === "playing" || canManage) && (
              <Button size="lg" className="min-w-0 flex-1 px-3!" onClick={() => { setRequestFor(null); setSheet("request"); }}>
                <HandCoins className="size-5" /> בקשת צ'יפים
              </Button>
            )}
            {canManage && (
              <Button size="lg" variant="soft" className="relative shrink-0 px-4!" onClick={() => setSheet("cashier")}>
                <ListChecks className="size-5" /> קופה
                {pending.length + flagged.length > 0 && (
                  <span className="pulse-ring absolute -left-1 -top-1 grid size-6 place-items-center rounded-full bg-gold text-xs font-extrabold text-[#1d1405]">
                    {pending.length + flagged.length}
                  </span>
                )}
              </Button>
            )}
            {t.isAdmin && (
              <Button size="lg" variant="soft" className="w-14 shrink-0 border border-loss/50 bg-loss/15! px-0! text-2xl" onClick={() => setSheet("close")} aria-label="סגירת ערב" title="סיום ערב">
                <span aria-hidden>🏁</span>
              </Button>
            )}
          </div>
        </div>
      )}

      <RequestSheet open={sheet === "request"} onClose={() => setSheet(null)} night={night} me={me} canManage={canManage} players={n.players} members={t.members} chipSet={chipSet} initialFor={requestFor} />
      <CashierSheet open={sheet === "cashier"} onClose={() => setSheet(null)} night={night} requests={n.requests} members={t.members} chipSet={chipSet} isAdmin={t.isAdmin} onHandover={() => setSheet("handover")} />
      {typeof sheet === "object" && sheet && "player" in sheet && (
        <PlayerSheet
          key={sheet.player}
          onClose={() => {
            setSheet(backToClose ? "close" : null);
            setBackToClose(false);
          }}
          isAdmin={t.isAdmin}
          settlements={n.settlements}
          table={t.table}
          night={night}
          memberId={sheet.player}
          players={n.players}
          requests={n.requests}
          members={t.members}
          lines={lines}
          chipSet={chipSet}
          canManage={canManage}
          onRequest={open ? () => { setRequestFor(sheet.player); setSheet("request"); } : undefined}
        />
      )}
      <CloseSheet open={sheet === "close"} onClose={() => setSheet(null)} night={night} players={n.players} lines={lines} members={t.members} chipSet={chipSet} pendingCount={pending.length + flagged.length} flaggedCount={flagged.length} handovers={n.handovers} table={t.table!} onPlayer={(id) => { setBackToClose(true); setSheet({ player: id }); }} />
      <AdminSheet open={sheet === "admin"} onClose={() => setSheet(null)} night={night} players={n.players} members={t.members} requests={n.requests} onHandover={() => setSheet("handover")} onCashout={(id) => setSheet({ player: id })} />
      <HandoverSheet open={sheet === "handover"} onClose={() => setSheet(null)} night={night} players={n.players} lines={lines} members={t.members} chipSet={chipSet} handovers={n.handovers} />
    </>
  );
}
