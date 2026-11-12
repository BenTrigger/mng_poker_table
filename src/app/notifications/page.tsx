"use client";
import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Bell, CalendarClock, MapPin, PlayCircle, Trophy, UserPlus, Armchair, Coins, Ban, Flag, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/hooks";
import { useNotifications, timeAgo, type AppNotification } from "@/lib/notifications";
import { TopBar } from "@/components/top-bar";
import { PushCard } from "@/components/push-card";
import { Card, Empty, Spinner } from "@/components/ui";

const ICONS: Record<string, React.ReactNode> = {
  night_started: <PlayCircle className="size-5" />,
  tournament_started: <Trophy className="size-5" />,
  signup_open: <CalendarClock className="size-5" />,
  tournament_open: <Trophy className="size-5" />,
  signup_changed: <MapPin className="size-5" />,
  tournament_changed: <MapPin className="size-5" />,
  seat_freed: <Armchair className="size-5" />,
  tournament_seat: <Armchair className="size-5" />,
  signup_added: <Armchair className="size-5" />,
  signup_joined: <UserPlus className="size-5" />,
  join_request: <UserPlus className="size-5" />,
  join_approved: <CheckCircle2 className="size-5" />,
  chip_request: <Coins className="size-5" />,
  signup_cancelled: <Ban className="size-5" />,
  tournament_cancelled: <Ban className="size-5" />,
  night_closed: <Flag className="size-5" />,
};
const HOT = new Set(["night_started", "tournament_started", "seat_freed", "tournament_seat"]);

function Row({ n }: { n: AppNotification }) {
  const tone = n.kind.endsWith("cancelled") ? "bg-loss/15 text-loss" : HOT.has(n.kind) ? "bg-win/15 text-win" : "bg-gold/10 text-gold";
  const inner = (
    <Card className={`flex items-start gap-3 transition hover:border-gold/30 ${n.read_at ? "opacity-75" : "border-gold/30"}`}>
      <div className={`grid size-10 shrink-0 place-items-center rounded-full ${tone}`}>{ICONS[n.kind] ?? <Bell className="size-5" />}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <div className="min-w-0 flex-1 font-bold">{n.title}</div>
          <div className="shrink-0 text-[0.7rem] text-muted">{timeAgo(n.created_at)}</div>
        </div>
        {n.body && <div className="mt-0.5 text-sm text-muted">{n.body}</div>}
      </div>
      {!n.read_at && <span className="mt-2 size-2 shrink-0 rounded-full bg-gold" aria-label="חדש" />}
    </Card>
  );
  return n.url ? <Link href={n.url}>{inner}</Link> : inner;
}

export default function NotificationsPage() {
  const { user, loading } = useAuth();
  const { items, markRead } = useNotifications(user?.id, 80);
  // opened the list = seen them all (after showing which ones were new)
  const marked = useRef(false);
  useEffect(() => {
    if (!items || marked.current || !items.some((n) => !n.read_at)) return;
    marked.current = true;
    const t = setTimeout(() => markRead(), 1500);
    return () => clearTimeout(t);
  }, [items, markRead]);

  const groups = useMemo(() => {
    if (!items) return [];
    const today = new Date().toDateString();
    const g: { label: string; list: AppNotification[] }[] = [];
    for (const n of items) {
      const d = new Date(n.created_at);
      const label = d.toDateString() === today ? "היום" : Date.now() - d.getTime() < 7 * 864e5 ? "השבוע" : "מוקדם יותר";
      const last = g[g.length - 1];
      if (last?.label === label) last.list.push(n);
      else g.push({ label, list: [n] });
    }
    return g;
  }, [items]);

  if (loading || !items) return <Spinner />;

  return (
    <>
      <TopBar title="התראות" sub="מה קרה בשולחנות שלך" back="/tables" bell={false} />
      <main className="mx-auto max-w-lg space-y-3 p-4">
        <PushCard />
        {items.length === 0 ? (
          <Empty
            icon={<Bell className="size-7" />}
            title="אין התראות עדיין"
            text="כאן יופיעו קריאות למשחק, הרשמות שנפתחו, שינויים בתאריך, בשעה ובכתובת ומקומות שהתפנו."
          />
        ) : (
          groups.map((g) => (
            <section key={g.label} className="space-y-2">
              <h2 className="px-1 pt-2 text-xs font-bold text-muted">{g.label}</h2>
              {g.list.map((n) => (
                <Row key={n.id} n={n} />
              ))}
            </section>
          ))
        )}
      </main>
    </>
  );
}
