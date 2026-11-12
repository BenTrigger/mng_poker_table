"use client";
// Design preview with sample data (development only). Not linked from the app.
import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { HandCoins, ListChecks, Flag } from "lucide-react";
import { PokerTable, type Seat } from "@/components/poker-table";
import { TopBar } from "@/components/top-bar";
import { Avatar, Badge, Button, Card } from "@/components/ui";
import { Summary, EventFeed } from "../t/[code]/n/[nightId]/sheets";
import type { ChipRequest, GameNight, Member, NightPlayer, Settlement, NightEvent } from "@/lib/types";
import { formatMoney, formatSigned, playerLines, settle } from "@/lib/calc";

const names = ["בן", "אורי", "דניאל", "יוסי", "מיכל", "רון", "עידו", "שני"];
const members: Member[] = names.map((n, i) => ({
  id: `m${i}`, table_id: "t", user_id: `u${i}`, display_name: n, avatar_url: null, role: i === 0 ? "admin" : "player", status: "active", created_at: "",
}));
const night: GameNight = {
  id: "n", table_id: "t", status: "open", chip_set_id: null, chips_per_buyin: 1000, money_per_buyin: 100, cashier_member_id: "m1",
  created_by: null, started_at: new Date().toISOString(), closed_at: null, photos_purged: false,
};
const bought = [2000, 1000, 3000, 1000, 1500, 0, 2000, 1000];
const finals = [3400, 0, 1200, 2600, 1500, 0, 1900, 900];
const players: NightPlayer[] = members.map((m, i) => ({
  id: `p${i}`, night_id: "n", member_id: m.id, seat: i, status: i === 5 ? "out" : "playing", final_chips: finals[i], final_photo_path: null,
  left_at: null, bought_money: bought[i] / 10, net: (finals[i] - bought[i]) / 10,
}));
const requests: ChipRequest[] = members.flatMap((m, i): ChipRequest[] =>
  bought[i]
    ? [{ id: `r${i}`, night_id: "n", member_id: m.id, requested_by: null, mode: "chips" as const, chips: bought[i], given_chips: null, detected_chips: null, status: "approved" as const, photo_path: null, note: null, approved_by: null, approved_at: null, created_at: "" }]
    : [],
).concat([{ id: "rp", night_id: "n", member_id: "m3", requested_by: null, mode: "chips", chips: 1000, given_chips: null, detected_chips: null, status: "pending", photo_path: null, note: null, approved_by: null, approved_at: null, created_at: "" }]);

export default function Preview() {
  if (process.env.NODE_ENV === "production") notFound();
  const [mode, setMode] = useState<"live" | "closed">("live");
  useEffect(() => {
    if (location.hash === "#closed") setMode("closed");
  }, []);
  const lines = playerLines(night, players, requests);
  const closed = mode === "closed";
  const seats: Seat[] = players.map((p, i) => {
    const l = lines[i];
    const showNet = closed;
    return {
      id: p.member_id, name: names[i], amount: showNet ? formatSigned(p.net) : formatMoney(l.boughtMoney),
      sub: showNet ? undefined : l.buyins ? `${l.buyins} כניסות` : "טרם קנה",
      tone: showNet ? (p.net! >= 0 ? "win" : "loss") : l.boughtMoney ? "gold" : "muted",
      isCashier: p.member_id === "m1", isMe: i === 0, pending: l.pendingChips > 0,
    };
  });
  const settlements: Settlement[] = settle(players.map((p) => ({ id: p.member_id, net: Number(p.net) }))).map((t, i) => ({
    id: `s${i}`, night_id: "n", from_member: t.from, to_member: t.to, amount: t.amount, paid: i === 0, paid_at: null,
  }));
  const events: NightEvent[] = [
    { id: 3, night_id: "n", actor_id: null, kind: "flagged", payload: { member_id: "m2", requested: 1000, detected: 950 }, created_at: new Date().toISOString() },
    { id: 2, night_id: "n", actor_id: null, kind: "approved", payload: { member_id: "m0", given: 1000 }, created_at: new Date().toISOString() },
    { id: 1, night_id: "n", actor_id: null, kind: "request", payload: { member_id: "m3", chips: 1000 }, created_at: new Date().toISOString() },
  ];
  const total = lines.reduce((s, l) => s + l.boughtMoney, 0);

  return (
    <>
      <TopBar title={closed ? "סיכום ערב · חמישי 12.11" : "ערב חמישי 12.11"} sub="1,000 צ'יפים = ₪100 · קופאי: אורי" back="/" />
      <main className="mx-auto max-w-lg px-3 pb-36 pt-2">
        <PokerTable
          seats={seats}
          center={
            <div>
              <div className="text-[11px] font-bold text-white/60">בקופה</div>
              <div className="num font-[family-name:var(--font-display)] text-3xl font-extrabold text-white">{formatMoney(total)}</div>
              <div className="num text-[11px] text-white/60">{(total * 10).toLocaleString()} צ'יפים</div>
              {!closed && (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-bold text-gold">
                  <HandCoins className="size-3.5" /> 1 ממתינים לקופאי
                </div>
              )}
            </div>
          }
        />
        {closed ? (
          <Summary night={{ ...night, status: "closed", photos_purged: true }} players={players} lines={lines} settlements={settlements} members={members} meId="m0" isAdmin reload={() => {}} />
        ) : (
          <Card className="p-0">
            <div className="px-4 pb-1 pt-4 font-bold">מי קנה ובכמה</div>
            <div className="divide-y divide-line">
              {[...lines].sort((a, b) => b.boughtMoney - a.boughtMoney).map((l) => (
                <div key={l.member_id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={names[+l.member_id.slice(1)]} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold">{names[+l.member_id.slice(1)]} {l.pendingChips > 0 && <Badge tone="warn">ממתין</Badge>}</div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full bg-gradient-to-l from-[#ffd77a] to-gold-2" style={{ width: `${(l.boughtMoney / 300) * 100}%` }} />
                    </div>
                  </div>
                  <div className="num font-extrabold">{formatMoney(l.boughtMoney)}</div>
                </div>
              ))}
            </div>
            <EventFeed events={events} members={members} />
          </Card>
        )}
      </main>
      {!closed && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line p-3">
          <div className="mx-auto flex max-w-lg gap-2">
            <Button size="lg" className="flex-1"><HandCoins className="size-5" /> בקשת צ'יפים</Button>
            <Button size="lg" variant="soft" className="relative"><ListChecks className="size-5" /> קופה
              <span className="pulse-ring absolute -left-1 -top-1 grid size-6 place-items-center rounded-full bg-gold text-xs font-extrabold text-[#1d1405]">1</span>
            </Button>
            <Button size="lg" variant="soft"><Flag className="size-5" /></Button>
          </div>
        </div>
      )}
      <button className="fixed left-3 top-20 z-40 rounded-full bg-black/60 px-3 py-1 text-xs" onClick={() => setMode(closed ? "live" : "closed")}>
        {closed ? "live" : "closed"}
      </button>
    </>
  );
}
