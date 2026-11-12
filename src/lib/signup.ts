import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase/client";
import type { Signup, SignupSeat, SignupView } from "./types";

export const signupDate = (s: string) =>
  new Date(s).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" });
export const signupTime = (s: string) => new Date(s).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

export const signupLink = (origin: string, id: string) => `${origin}/s/${id}`;

/** Seats 1..n, each with whoever sits there (or null when free) */
export function seatMap(seats: SignupSeat[], n: number): (SignupSeat | null)[] {
  return Array.from({ length: n }, (_, i) => seats.find((s) => s.seat === i + 1) ?? null);
}

export const waitingList = (seats: SignupSeat[]) =>
  seats.filter((s) => s.seat === null).sort((a, b) => a.created_at.localeCompare(b.created_at));

/** WhatsApp message for the sign-up: when, where, who is in, how many seats are left, and the link */
export function signupShareText(tableName: string, s: Signup, seats: SignupSeat[], link: string) {
  const map = seatMap(seats, s.seats);
  const taken = map.filter(Boolean) as SignupSeat[];
  const free = s.seats - taken.length;
  const wait = waitingList(seats);
  const lines = [
    `♠️ ערב פוקר - ${tableName}`,
    `📅 ${signupDate(s.starts_at)} בשעה ${signupTime(s.starts_at)}`,
  ];
  if (s.location) lines.push(`📍 ${s.location}`);
  if (s.note) lines.push(`📝 ${s.note}`);
  lines.push("");
  if (taken.length) {
    lines.push(`רשומים (${taken.length}/${s.seats}):`);
    map.forEach((p, i) => p && lines.push(`${i + 1}. ${p.display_name}`));
    lines.push("");
  }
  if (wait.length) lines.push(`ממתינים: ${wait.map((w) => w.display_name).join(", ")}`, "");
  if (s.status !== "open") lines.push("ההרשמה סגורה.");
  else lines.push(free > 0 ? `נשארו ${free} מקומות. תפסו מקום בשולחן 👇` : "השולחן מלא. אפשר להירשם לרשימת המתנה 👇", link);
  return lines.join("\n");
}

export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** A sign-up as seen through its link, kept live with realtime */
export function useSignup(id: string, enabled: boolean) {
  const [view, setView] = useState<SignupView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    const { data, error } = await supabase().rpc("get_signup", { p_id: id });
    if (error || !data) setNotFound(true);
    else setView(data as SignupView);
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
      .channel(`signup-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "signup_seats", filter: `signup_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "signups", filter: `id=eq.${id}` }, load)
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

/** Upcoming sign-ups of a table (open or closed, not yet started) */
export function useTableSignups(tableId: string) {
  const [rows, setRows] = useState<(Signup & { taken: number; waiting: number; mine: boolean })[]>([]);
  const load = useCallback(async () => {
    const sb = supabase();
    const { data } = await sb
      .from("signups")
      .select("*, signup_seats(seat, member_id, table_members(user_id))")
      .eq("table_id", tableId)
      .in("status", ["open", "closed"])
      .order("starts_at");
    const { data: u } = await sb.auth.getUser();
    type Row = Signup & { signup_seats: { seat: number | null; table_members: { user_id: string | null } | null }[] };
    setRows(
      ((data as Row[] | null) ?? []).map(({ signup_seats, ...s }) => ({
        ...s,
        taken: signup_seats.filter((x) => x.seat !== null).length,
        waiting: signup_seats.filter((x) => x.seat === null).length,
        mine: signup_seats.some((x) => x.table_members?.user_id === u.user?.id),
      })),
    );
  }, [tableId]);
  useEffect(() => {
    load();
    const sb = supabase();
    const ch = sb
      .channel(`signups-${tableId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "signups", filter: `table_id=eq.${tableId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "signup_seats" }, load)
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [tableId, load]);
  return { rows, reload: load };
}

/** Hebrew text for errors raised by the sign-up functions */
export function signupError(msg: string) {
  if (msg.includes("seat taken")) return "מישהו תפס את המקום הזה הרגע. בחר מקום אחר.";
  if (msg.includes("signup is closed")) return "ההרשמה נסגרה.";
  if (msg.includes("removed from table")) return "הוסרת מהשולחן הזה.";
  if (msg.includes("signup not found")) return "ההרשמה לא נמצאה.";
  return msg;
}
