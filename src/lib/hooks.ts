"use client";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase/client";
import type {
  ChipRequest, ChipSet, GameNight, Member, NightEvent, NightPlayer, PokerTable, Profile, Settlement,
} from "./types";

export function useAuth({ required = true }: { required?: boolean } = {}) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = supabase();
    let alive = true;
    sb.auth.getUser().then(async ({ data }) => {
      if (!alive) return;
      setUser(data.user);
      if (data.user) {
        const { data: p } = await sb.from("profiles").select("*").eq("id", data.user.id).single();
        if (alive) setProfile(p);
      } else if (required) {
        window.location.href = `/?next=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [required]);

  return { user, profile, loading };
}

export async function signInWithGoogle(next = "/tables") {
  await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
}

export function useTable(code: string, userId: string | undefined) {
  const [table, setTable] = useState<PokerTable | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [chipSets, setChipSets] = useState<ChipSet[]>([]);
  const [nights, setNights] = useState<GameNight[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const sb = supabase();
    const { data: t } = await sb.from("poker_tables").select("*").eq("code", code.toUpperCase()).maybeSingle();
    if (!t) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const [m, c, n] = await Promise.all([
      sb.from("table_members").select("*").eq("table_id", t.id).order("created_at"),
      sb.from("chip_sets").select("*").eq("table_id", t.id).order("created_at", { ascending: false }),
      sb.from("game_nights").select("*").eq("table_id", t.id).order("started_at", { ascending: false }),
    ]);
    setTable(t);
    setMembers(m.data ?? []);
    setChipSets(c.data ?? []);
    setNights(n.data ?? []);
    setLoading(false);
  }, [code, userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!table) return;
    const sb = supabase();
    const ch = sb
      .channel(`table-${table.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "table_members", filter: `table_id=eq.${table.id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_nights", filter: `table_id=eq.${table.id}` }, load)
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [table, load]);

  const me = members.find((m) => m.user_id === userId) ?? null;
  return { table, members, chipSets, nights, me, isAdmin: me?.role === "admin" && me.status === "active", loading, notFound, reload: load };
}

export function useNight(nightId: string, enabled: boolean) {
  const [night, setNight] = useState<GameNight | null>(null);
  const [players, setPlayers] = useState<NightPlayer[]>([]);
  const [requests, setRequests] = useState<ChipRequest[]>([]);
  const [events, setEvents] = useState<NightEvent[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!enabled) return;
    const sb = supabase();
    const [n, p, r, e, s] = await Promise.all([
      sb.from("game_nights").select("*").eq("id", nightId).maybeSingle(),
      sb.from("night_players").select("*").eq("night_id", nightId).order("seat"),
      sb.from("chip_requests").select("*").eq("night_id", nightId).order("created_at"),
      sb.from("night_events").select("*").eq("night_id", nightId).order("created_at", { ascending: false }).limit(200),
      sb.from("settlements").select("*").eq("night_id", nightId),
    ]);
    setNight(n.data);
    setPlayers(p.data ?? []);
    setRequests(r.data ?? []);
    setEvents(e.data ?? []);
    setSettlements(s.data ?? []);
    setLoading(false);
  }, [nightId, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    const sb = supabase();
    const f = `night_id=eq.${nightId}`;
    const ch = sb
      .channel(`night-${nightId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_nights", filter: `id=eq.${nightId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "night_players", filter: f }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "chip_requests", filter: f }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "night_events", filter: f }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "settlements", filter: f }, load)
      .subscribe();
    // refresh when the app comes back to the foreground (phones suspend sockets)
    const vis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", vis);
    return () => {
      sb.removeChannel(ch);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [nightId, enabled, load]);

  return { night, players, requests, events, settlements, loading, reload: load };
}

export async function logEvent(nightId: string, kind: string, payload: Record<string, unknown> = {}) {
  const sb = supabase();
  const { data } = await sb.auth.getUser();
  await sb.from("night_events").insert({ night_id: nightId, actor_id: data.user?.id, kind, payload });
}
