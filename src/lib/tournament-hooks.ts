import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase/client";
import type { Tournament, TournamentEntry, TournamentView } from "./types";

/** A tournament as seen through its link, kept live with realtime */
export function useTournament(id: string, enabled: boolean) {
  const [view, setView] = useState<TournamentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    const { data, error } = await supabase().rpc("get_tournament", { p_id: id });
    if (error || !data) setNotFound(true);
    else setView(data as TournamentView);
    setLoading(false);
  }, [id, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  // realtime only reaches members (RLS); everyone else refreshes on focus and every 20s
  useEffect(() => {
    if (!enabled) return;
    const sb = supabase();
    const ch = sb
      .channel(`tournament-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_entries", filter: `tournament_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments", filter: `id=eq.${id}` }, load)
      .subscribe();
    const vis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", vis);
    const timer = setInterval(vis, 20000);
    return () => {
      sb.removeChannel(ch);
      document.removeEventListener("visibilitychange", vis);
      clearInterval(timer);
    };
  }, [id, enabled, load]);

  return { view, loading, notFound, reload: load };
}

export type TournamentRow = Tournament & { entries: Pick<TournamentEntry, "member_id" | "status" | "place" | "prize" | "rebuys" | "addon">[] };

/** All tournaments of a table, with their entries (for the list and the stats) */
export function useTableTournaments(tableId: string) {
  const [rows, setRows] = useState<TournamentRow[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase()
      .from("tournaments")
      .select("*, entries:tournament_entries(member_id, status, place, prize, rebuys, addon)")
      .eq("table_id", tableId)
      .order("starts_at", { ascending: false });
    setRows((data as TournamentRow[] | null) ?? []);
  }, [tableId]);
  useEffect(() => {
    load();
    const sb = supabase();
    const ch = sb
      .channel(`tournaments-${tableId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments", filter: `table_id=eq.${tableId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_entries" }, load)
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [tableId, load]);
  return { rows, reload: load };
}

/** Re-render every second (for the clock) */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
