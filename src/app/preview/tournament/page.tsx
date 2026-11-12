"use client";
// Tournament design preview with sample data (development only). Not linked from the app.
import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { TournamentFormView } from "@/components/tournament-section";
import { blindStructure, clockState } from "@/lib/tournament";
import { useNow } from "@/lib/tournament-hooks";
import type { Tournament, TournamentEntryView, TournamentView } from "@/lib/types";
import { LiveView } from "../../tr/[id]/live";
import { ResultsView } from "../../tr/[id]/results";

const names = ["בן", "אורי", "דניאל", "יוסי", "מיכל", "רון", "עידו", "שני", "טל", "נועה", "גיל", "אבי", "רותם", "שחר"];
const base = Date.now();
const t: Tournament = {
  id: "t", table_id: "tb", name: "טורניר חמישי", starts_at: new Date(base).toISOString(), location: "אצל בן", note: null,
  table_count: 2, seats_per_table: 9, buy_in: 100, starting_stack: 10000, rebuy_until_level: 4, rebuy_price: null, rebuy_chips: null,
  addon_price: 100, addon_chips: 10000, late_reg_until_level: 4, levels: blindStructure(10000, 20), registration_open: false,
  status: "running", clock_anchor: new Date(base - 47 * 60_000 - 13_000).toISOString(), paused_at: null,
  started_at: null, finished_at: null, created_by: "u0", created_at: "",
};
const entry = (i: number, p: Partial<TournamentEntryView>): TournamentEntryView => ({
  id: `e${i}`, tournament_id: "t", member_id: `m${i}`, status: "playing", table_no: null, seat_no: null, rebuys: 0, addon: false,
  busted_at: null, busted_by: null, place: null, prize: null, created_at: `2026-11-20T17:00:${String(10 + i)}Z`,
  display_name: names[i], avatar_url: null, user_id: `u${i}`, ...p,
});
const live: TournamentEntryView[] = names.map((_, i) =>
  i < 12
    ? entry(i, { table_no: i % 2 ? 2 : 1, seat_no: [1, 2, 4, 3, 5, 7, 6, 8, 8, 9, 9, 5][i], rebuys: i === 3 ? 1 : 0 })
    : entry(i, { status: "busted", busted_at: `2026-11-20T18:${30 + i}:00Z`, busted_by: "m2" }),
);
// one extra at table 1 so the tables need balancing
live[12] = entry(12, { table_no: 1, seat_no: 3 });
live[2] = { ...live[2], table_no: 1, seat_no: 4 };
const finished: TournamentEntryView[] = names.slice(0, 10).map((_, i) =>
  entry(i, { status: "busted", place: i + 1, prize: [800, 450, 250][i] ?? 0, rebuys: i === 0 || i === 4 ? 1 : 0, addon: i < 3 }),
);

export default function TournamentPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  const [mode, setMode] = useState<"live" | "results" | "new">("live");
  useEffect(() => {
    if (location.hash === "#results") setMode("results");
    if (location.hash === "#new") setMode("new");
  }, []);
  const now = useNow(mode === "live");
  const run = async () => true;
  const view: TournamentView = {
    tournament: { ...t, status: "finished" },
    table: { id: "tb", name: "החבר'ה", code: "ABC123", stats_visibility: "all", settle_mode: "players" },
    me: { id: "m0", status: "active", role: "admin" },
    organizer_member_id: "m0",
    entries: finished,
  };
  return (
    <>
      <TopBar title={t.name} sub="החבר'ה" back="/tables" />
      <main className="mx-auto max-w-lg space-y-4 px-4 pb-20 pt-3">
        {mode === "live" && <LiveView t={t} entries={live} clock={clockState(t, now)!} now={now} isAdmin myId="m0" busy={false} run={run} onAdd={() => {}} />}
        {mode === "results" && <ResultsView view={view} isAdmin myId="m0" run={run} />}
        {mode === "new" && <TournamentFormView tableId="tb" />}
      </main>
    </>
  );
}
