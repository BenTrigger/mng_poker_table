"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase/client";

export type AppNotification = {
  id: number;
  user_id: string;
  table_id: string | null;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  read_at: string | null;
  created_at: string;
};

/** The signed-in user's latest notifications, live. */
export function useNotifications(userId: string | null | undefined, limit = 60) {
  const [items, setItems] = useState<AppNotification[] | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase()
      .from("notifications")
      .select("id, user_id, table_id, kind, title, body, url, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    setItems((data as AppNotification[]) ?? []);
  }, [userId, limit]);

  useEffect(() => {
    if (!userId) return;
    load();
    const sb = supabase();
    const ch = sb
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      sb.removeChannel(ch);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [userId, load]);

  const markRead = useCallback(
    async (ids?: number[]) => {
      setItems((cur) => cur?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)) ?? cur);
      await supabase().rpc("mark_notifications_read", { p_ids: ids ?? null });
    },
    [],
  );

  const unread = items?.filter((n) => !n.read_at).length ?? 0;
  return { items, unread, markRead, reload: load };
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "עכשיו";
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "לפני דקה" : `לפני ${m} דק׳`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : h === 2 ? "לפני שעתיים" : `לפני ${h} שעות`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? "אתמול" : `לפני ${d} ימים`;
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
}
