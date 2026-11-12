"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Share2, Undo2, Lock, Check } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { results, tournamentResultText, upfrontPayouts } from "@/lib/tournament";
import { formatMoney, formatSigned, settle, settleViaHub } from "@/lib/calc";
import { whatsappUrl } from "@/lib/signup";
import { Avatar, Badge, Button, Card } from "@/components/ui";
import type { TournamentView } from "@/lib/types";
import type { RunFn } from "./page";

export function ResultsView({ view, isAdmin, myId, run }: { view: TournamentView; isAdmin: boolean; myId: string | null; run: RunFn }) {
  const { tournament: t, entries, table } = view;
  // same rule as the table's statistics: "own" = players see only their own money (admins see all)
  const seeAll = isAdmin || table.stats_visibility === "all";
  const hub = table.settle_mode === "cashier" ? view.organizer_member_id : null;
  const saved = useMemo(() => view.transfers ?? [], [view.transfers]);
  // once saved, the switch shows how the saved transfers were made
  const [mode, setMode] = useState<"players" | "hub">(() => {
    const org = view.organizer_member_id;
    if (saved.length && org) return saved.every((x) => x.from_member === org || x.to_member === org) ? "hub" : "players";
    return hub ? "hub" : "players";
  });

  const rows = useMemo(() => results(t, entries), [t, entries]);
  const name = (memberId: string) => entries.find((e) => e.member_id === memberId)?.display_name ?? "המארגן";
  const nets = rows.map((r) => ({ id: r.member_id, net: r.net }));
  // cash paid at the door: the organizer holds the pot and pays out the prizes
  const upfront = t.payment_mode === "upfront";
  // worked out on the admin's screen (only the admin sees every prize), then saved for everyone
  const planned = useMemo(
    () =>
      upfront
        ? upfrontPayouts(rows, view.organizer_member_id ?? "")
        : mode === "hub" && view.organizer_member_id
          ? settleViaHub(nets, view.organizer_member_id)
          : settle(nets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, mode, upfront, view.organizer_member_id],
  );
  const anyPaid = saved.some((x) => x.paid);
  const key = (from: string, to: string, amount: number) => `${from}>${to}:${Math.round(Number(amount) * 100)}`;
  const sameAsSaved =
    planned.map((p) => key(p.from, p.to, p.amount)).sort().join() === saved.map((x) => key(x.from_member, x.to_member, x.amount)).sort().join();
  const saving = useRef(false);
  useEffect(() => {
    if (!isAdmin || anyPaid || sameAsSaved || saving.current) return;
    saving.current = true;
    supabase()
      .rpc("save_tournament_transfers", { p_id: t.id, p_transfers: planned.map((x) => ({ from: x.from, to: x.to, amount: x.amount })) })
      .then(() => {
        saving.current = false;
      });
  }, [isAdmin, anyPaid, sameAsSaved, planned, t.id]);
  const transfers =
    saved.length || !isAdmin
      ? saved.map((x) => ({ id: x.id, from: x.from_member, to: x.to_member, amount: Number(x.amount), paid: x.paid })).sort((a, b) => b.amount - a.amount)
      : planned.map((x) => ({ id: "", from: x.from, to: x.to, amount: x.amount, paid: false }));
  const visibleTransfers = seeAll ? transfers : transfers.filter((x) => x.from === myId || x.to === myId);
  const markPaid = (id: string, paid: boolean) =>
    run("paid", () => supabase().from("tournament_transfers").update({ paid, paid_at: paid ? new Date().toISOString() : null }).eq("id", id), paid ? "סומן ששולם" : "הסימון בוטל");
  const shareText = tournamentResultText(
    t,
    rows.map((r) => ({ name: name(r.member_id), place: r.place, prize: r.prize, net: r.net })),
    transfers.map((x) => ({ from: name(x.from), to: name(x.to), amount: x.amount })),
  );
  const podium = rows.slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="felt rounded-[32px] p-6 text-center">
        <div className="text-4xl">🏆</div>
        <div className="mt-1 font-[family-name:var(--font-display)] text-3xl font-extrabold text-white">{podium[0] ? name(podium[0].member_id) : ""}</div>
        <div className="text-sm text-white/70">אלוף {t.name}</div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {podium.map((r, i) => (
            <div key={r.id} className="rounded-2xl bg-black/30 p-2">
              <div className="text-xl">{["🥇", "🥈", "🥉"][i]}</div>
              <div className="truncate text-sm font-bold text-white">{name(r.member_id)}</div>
              {(seeAll || r.member_id === myId) && r.prize > 0 && <div className="num text-xs font-bold text-gold">{formatMoney(r.prize)}</div>}
            </div>
          ))}
        </div>
      </div>

      {!seeAll && (
        <Card className="flex items-center gap-2 text-sm text-muted">
          <Lock className="size-4 shrink-0" /> המנהל הגדיר שכל שחקן רואה רק את הסכומים שלו.
        </Card>
      )}

      <section>
        <h2 className="mb-2 px-1 text-sm font-bold text-muted">דירוג סופי</h2>
        <Card className="divide-y divide-line p-0">
          {rows.map((r) => {
            const e = entries.find((x) => x.id === r.id)!;
            const show = seeAll || r.member_id === myId;
            return (
              <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${r.member_id === myId ? "bg-gold/5" : ""}`}>
                <span className={`num w-6 text-center font-extrabold ${r.place <= 3 ? "text-gold" : "text-muted"}`}>{r.place}</span>
                <Avatar name={e.display_name} src={e.avatar_url} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{e.display_name}</div>
                  {show && (
                    <div className="num text-[11px] text-muted">
                      שילם {formatMoney(r.cost)}
                      {e.rebuys ? ` · ריביי ×${e.rebuys}` : ""}
                      {e.addon ? " · אד-און" : ""}
                    </div>
                  )}
                </div>
                {show && r.prize > 0 && <Badge tone="gold">{formatMoney(r.prize)}</Badge>}
                {show && <div className={`num w-20 text-left font-extrabold ${r.net >= 0 ? "text-win" : "text-loss"}`}>{formatSigned(r.net)}</div>}
              </div>
            );
          })}
        </Card>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-muted">{upfront ? "המארגן משלם את הפרסים" : "מי מעביר למי"}</h2>
          {view.organizer_member_id && !upfront && isAdmin && !anyPaid && (
            <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-xs font-bold">
              <button className={`rounded-lg px-2 py-1 ${mode === "players" ? "bg-gold text-[#1d1405]" : "text-muted"}`} onClick={() => setMode("players")}>
                בין השחקנים
              </button>
              <button className={`rounded-lg px-2 py-1 ${mode === "hub" ? "bg-gold text-[#1d1405]" : "text-muted"}`} onClick={() => setMode("hub")}>
                דרך המארגן
              </button>
            </div>
          )}
        </div>
        <Card className="space-y-2">
          {visibleTransfers.length === 0 ? (
            <p className="text-center text-sm text-muted">{upfront ? "כולם שילמו בכניסה. אין העברות." : "אין העברות."}</p>
          ) : (
            visibleTransfers.map((x, i) => {
              const canMark = !!x.id && (isAdmin || x.to === myId);
              return (
                <div key={x.id || i} className="flex items-center gap-2 text-sm">
                  <b className={x.from === myId ? "text-loss" : ""}>{name(x.from)}</b>
                  <span className="text-muted">מעביר ל</span>
                  <b className={x.to === myId ? "text-win" : ""}>{name(x.to)}</b>
                  <span className="num mr-auto font-extrabold">{formatMoney(x.amount)}</span>
                  {x.paid ? (
                    canMark ? (
                      <button className="text-xs font-bold text-win" onClick={() => markPaid(x.id, false)} aria-label={`בטל סימון ששולם: ${name(x.from)} ל${name(x.to)}`}>
                        ✅ שולם
                      </button>
                    ) : (
                      <span className="text-xs font-bold text-win">✅ שולם</span>
                    )
                  ) : canMark ? (
                    <Button size="sm" variant="soft" onClick={() => markPaid(x.id, true)} aria-label={`קיבלתי: ${name(x.from)} ל${name(x.to)}`}>
                      <Check className="size-4" /> קיבלתי
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </Card>
      </section>

      {isAdmin && (
        <div className="grid grid-cols-2 gap-2">
          <a href={whatsappUrl(shareText)} target="_blank" rel="noreferrer">
            <Button className="w-full">
              <Share2 className="size-4" /> שיתוף תוצאות
            </Button>
          </a>
          <Button
            variant="soft"
            onClick={() => confirm("לפתוח מחדש את הטורניר? הפרסים יימחקו והמנצח יחזור לשחק.") && run("reopen", () => supabase().rpc("reopen_tournament", { p_id: t.id }), "הטורניר נפתח מחדש")}
          >
            <Undo2 className="size-4" /> פתיחה מחדש
          </Button>
        </div>
      )}
    </div>
  );
}
