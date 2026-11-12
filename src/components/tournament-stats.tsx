"use client";
import { useMemo } from "react";
import Link from "next/link";
import { Trophy, Medal, Lock } from "lucide-react";
import { useTableTournaments } from "@/lib/tournament-hooks";
import { tournamentStats } from "@/lib/tournament";
import { formatSigned } from "@/lib/calc";
import type { Member } from "@/lib/types";
import { Avatar, Card, Empty } from "./ui";

/** Tournament leaderboard of a table. With seeAll false, a player sees only their own line. */
export function TournamentStatsView({ tableId, members, meId, seeAll }: { tableId: string; members: Member[]; meId: string; seeAll: boolean }) {
  const { rows } = useTableTournaments(tableId);
  const finished = rows.filter((t) => t.status === "finished");
  const all = useMemo(() => tournamentStats(rows), [rows]);
  const stats = seeAll ? all : all.filter((s) => s.member_id === meId);
  const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? "שחקן";

  if (!finished.length) return <Empty icon={<Trophy className="size-7" />} title="עוד אין טורנירים שהסתיימו" text="אחרי הטורניר הראשון יופיעו כאן אלופים, כניסות לכסף ומאזן." />;
  const me = all.find((s) => s.member_id === meId);

  return (
    <div className="space-y-4">
      {me && (
        <Card>
          <div className="text-xs text-muted">הטורנירים שלי · {me.played}</div>
          <div className={`num mt-1 font-[family-name:var(--font-display)] text-4xl font-extrabold ${me.net >= 0 ? "text-win" : "text-loss"}`}>{formatSigned(me.net)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Mini label="זכיות" value={String(me.wins)} />
            <Mini label="בכסף" value={`${me.cashes}/${me.played}`} />
            <Mini label="מקום ממוצע" value={String(me.avgPlace)} />
          </div>
        </Card>
      )}
      {!seeAll && (
        <p className="flex items-center justify-center gap-1 px-1 text-center text-xs text-muted">
          <Lock className="size-3" /> המנהל הגדיר שכל שחקן רואה רק את הנתונים שלו.
        </p>
      )}
      {seeAll && (
        <Card className="p-0">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <h2 className="font-bold">טבלת האלופים</h2>
            <span className="text-xs text-muted">{finished.length} טורנירים</span>
          </div>
          <div className="divide-y divide-line">
            {stats.map((s, i) => (
              <div key={s.member_id} className={`flex items-center gap-3 px-4 py-3 ${s.member_id === meId ? "bg-gold/5" : ""}`}>
                <span className={`num w-5 text-center font-extrabold ${i < 3 ? "text-gold" : "text-muted"}`}>{i + 1}</span>
                <Avatar name={name(s.member_id)} src={members.find((m) => m.id === s.member_id)?.avatar_url} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{name(s.member_id)}</div>
                  <div className="num text-[11px] text-muted">
                    {s.played} טורנירים · {s.cashes} בכסף · הכי טוב: מקום {s.best}
                  </div>
                </div>
                {s.wins > 0 && (
                  <span className="num inline-flex items-center gap-0.5 text-sm font-bold text-gold">
                    <Medal className="size-4" />
                    {s.wins}
                  </span>
                )}
                <div className={`num w-16 text-left font-extrabold ${s.net >= 0 ? "text-win" : "text-loss"}`}>{formatSigned(s.net)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <section>
        <h2 className="mb-2 px-1 text-sm font-bold text-muted">טורנירים אחרונים</h2>
        <div className="space-y-2">
          {finished.slice(0, 10).map((t) => {
            const winner = t.entries.find((e) => e.place === 1);
            return (
              <Link key={t.id} href={`/tr/${t.id}`} className="block">
                <Card className="flex items-center gap-3 py-3">
                  <Trophy className="size-5 text-gold" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{t.name}</div>
                    <div className="text-xs text-muted">
                      {new Date(t.starts_at).toLocaleDateString("he-IL")} · {t.entries.filter((e) => e.place != null).length} שחקנים
                    </div>
                  </div>
                  {winner && <span className="truncate text-sm font-bold">🥇 {name(winner.member_id)}</span>}
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
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
