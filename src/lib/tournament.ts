/**
 * Tournament math: blind structure, clock, prizes, table balancing, results.
 * Pure functions only (no Supabase), so they are easy to test.
 */
import { round2 } from "./calc";
import { wazeUrl } from "./signup";
import type { Tournament, TournamentEntry, TournamentLevel } from "./types";

// ---------------------------------------------------------------------------
// Blind structure
// ---------------------------------------------------------------------------

export type Speed = "turbo" | "regular" | "slow";

/** The tournament form (also remembered in the table's last settings for next time) */
export type TournamentForm = {
  name: string;
  startsAt: string;
  location: string;
  address: string;
  note: string;
  tables: number;
  seats: number;
  buyIn: number;
  stack: number;
  speed: Speed;
  rebuyLevels: number; // 0 = no rebuys
  addon: boolean;
  lateReg: number;
};

export const SPEEDS: Record<Speed, { label: string; minutes: number }> = {
  turbo: { label: "מהיר", minutes: 12 },
  regular: { label: "רגיל", minutes: 20 },
  slow: { label: "איטי", minutes: 30 },
};

/** Big blinds for a 10,000 chip starting stack (200 big blinds deep at level 1) */
const BASE_BB = [50, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 10000, 15000, 20000, 30000, 40000];
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** Round to a "nice" chip amount (1, 2, 2.5, 3, 4, 5, 6, 8 x 10^k), never below 1 */
export function niceRound(x: number): number {
  if (x <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const best = NICE.map((n) => n * p).reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  return best < 10 ? Math.round(best) : best; // no 1.5 / 2.5 chips
}

/**
 * A standard home-game structure scaled to the starting stack:
 * blinds go up every level, a 10 minute break after levels 4 and 8,
 * a big-blind ante from level 7.
 */
export function blindStructure(startingStack: number, minutes: number): TournamentLevel[] {
  const k = startingStack / 10000;
  const out: TournamentLevel[] = [];
  let prev = 0;
  BASE_BB.forEach((b, i) => {
    let bb = niceRound(b * k);
    if (bb <= prev) bb = prev * 2; // small stacks: keep blinds going up
    prev = bb;
    const sb = Number.isInteger(bb / 2) ? bb / 2 : Math.max(1, Math.floor(bb / 2));
    out.push({ sb, bb, ante: i >= 6 ? bb : 0, minutes });
    if (i === 3 || i === 7) out.push({ break: true, minutes: 10 });
  });
  return out;
}

/** 1-based number of a playing level (breaks are not counted) */
export function levelNumber(levels: TournamentLevel[], index: number): number {
  return levels.slice(0, index + 1).filter((l) => !l.break).length;
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export type ClockState = {
  index: number; // index into levels
  level: TournamentLevel;
  next: TournamentLevel | null;
  levelNo: number; // playing level number (1-based), the last one during a break
  elapsedMs: number; // in the current level
  remainingMs: number;
  paused: boolean;
  totalElapsedMs: number;
};

const msOf = (l: TournamentLevel) => l.minutes * 60_000;

export function clockState(
  t: Pick<Tournament, "levels" | "clock_anchor" | "paused_at">,
  now: number,
): ClockState | null {
  if (!t.clock_anchor || !t.levels.length) return null;
  const at = t.paused_at ? new Date(t.paused_at).getTime() : now;
  let rest = Math.max(0, at - new Date(t.clock_anchor).getTime());
  const total = rest;
  let i = 0;
  // the last level just keeps running
  while (i < t.levels.length - 1 && rest >= msOf(t.levels[i])) {
    rest -= msOf(t.levels[i]);
    i++;
  }
  const level = t.levels[i];
  return {
    index: i,
    level,
    next: t.levels[i + 1] ?? null,
    levelNo: levelNumber(t.levels, i),
    elapsedMs: rest,
    remainingMs: Math.max(0, msOf(level) - rest),
    paused: !!t.paused_at,
    totalElapsedMs: total,
  };
}

/** Start of level `index`, in ms from the anchor */
const startOf = (levels: TournamentLevel[], index: number) => levels.slice(0, index).reduce((s, l) => s + msOf(l), 0);

/**
 * New clock anchor so that the clock shows level `index` from its start
 * (or `elapsedMs` into it). Works while paused too.
 */
export function anchorFor(
  t: Pick<Tournament, "levels" | "paused_at">,
  index: number,
  now: number,
  elapsedMs = 0,
): string {
  const i = Math.max(0, Math.min(index, t.levels.length - 1));
  const at = t.paused_at ? new Date(t.paused_at).getTime() : now;
  return new Date(at - startOf(t.levels, i) - elapsedMs).toISOString();
}

/** Clock fields after pressing pause / resume */
export function togglePause(t: Pick<Tournament, "clock_anchor" | "paused_at">, now: number) {
  if (!t.clock_anchor) return {};
  if (t.paused_at) {
    const paused = now - new Date(t.paused_at).getTime();
    return { paused_at: null, clock_anchor: new Date(new Date(t.clock_anchor).getTime() + paused).toISOString() };
  }
  return { paused_at: new Date(now).toISOString() };
}

export const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

export const blindsLabel = (l: TournamentLevel) =>
  l.break ? "הפסקה" : `${l.sb!.toLocaleString()}/${l.bb!.toLocaleString()}${l.ante ? ` (${l.ante.toLocaleString()})` : ""}`;

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const rebuyPrice = (t: Pick<Tournament, "buy_in" | "rebuy_price">) => Number(t.rebuy_price ?? t.buy_in);
export const rebuyChips = (t: Pick<Tournament, "starting_stack" | "rebuy_chips">) => Number(t.rebuy_chips ?? t.starting_stack);

type Played = Pick<TournamentEntry, "status" | "rebuys" | "addon">;

/** What a player paid in: buy-in + rebuys + add-on */
export function entryCost(t: Pick<Tournament, "buy_in" | "rebuy_price" | "addon_price">, e: Pick<TournamentEntry, "rebuys" | "addon">) {
  return round2(Number(t.buy_in) + e.rebuys * rebuyPrice(t) + (e.addon ? Number(t.addon_price ?? 0) : 0));
}

const playedIn = (e: Played) => e.status === "playing" || e.status === "busted";

export function prizePool(t: Pick<Tournament, "buy_in" | "rebuy_price" | "addon_price">, entries: Played[]) {
  return round2(entries.filter(playedIn).reduce((s, e) => s + entryCost(t, e), 0));
}

/** Chips in play (for the average stack) */
export function chipsInPlay(t: Pick<Tournament, "starting_stack" | "rebuy_chips" | "addon_chips">, entries: Played[]) {
  return entries
    .filter(playedIn)
    .reduce((s, e) => s + Number(t.starting_stack) + e.rebuys * rebuyChips(t) + (e.addon ? Number(t.addon_chips ?? 0) : 0), 0);
}

/** Share of the prize pool per place (percent), by number of players */
export function payoutPercents(players: number): number[] {
  if (players <= 4) return [100];
  if (players <= 7) return [65, 35];
  if (players <= 14) return [50, 30, 20];
  if (players <= 24) return [40, 25, 20, 15];
  if (players <= 40) return [35, 22, 16, 12, 9, 6];
  return [30, 20, 14, 10, 8, 6.5, 5.5, 3.5, 2.5];
}

/**
 * Prize per place, rounded down to `unit` (default 10), with what is left
 * from the rounding going to the winner. Always sums to the pool.
 */
export function prizes(pool: number, players: number, unit = 10): number[] {
  const pct = payoutPercents(players).slice(0, Math.max(1, players));
  const sum = pct.reduce((a, b) => a + b, 0);
  const u = pool >= unit * 20 ? unit : 1;
  const out = pct.map((p) => Math.floor((pool * p) / sum / u) * u);
  out[0] = round2(out[0] + pool - out.reduce((a, b) => a + b, 0));
  return out;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

/**
 * Finishing order: players still in share the top places (in entry order),
 * then busted players, latest bust first. Returns entry ids, place 1 first.
 */
export function standings(entries: Pick<TournamentEntry, "id" | "status" | "busted_at" | "place" | "created_at">[]): string[] {
  const played = entries.filter((e) => e.status === "playing" || e.status === "busted");
  if (played.length && played.every((e) => e.place != null)) {
    return [...played].sort((a, b) => a.place! - b.place!).map((e) => e.id);
  }
  const alive = played.filter((e) => e.status === "playing").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out = played
    .filter((e) => e.status === "busted")
    .sort((a, b) => (b.busted_at ?? "").localeCompare(a.busted_at ?? ""));
  return [...alive, ...out].map((e) => e.id);
}

/** Place a busted player finished in (number of players who were still in when they went out + 1) */
export function placeOf(entries: Parameters<typeof standings>[0], id: string) {
  const i = standings(entries).indexOf(id);
  return i < 0 ? null : i + 1;
}

/** Net result per player: prize minus what they paid in */
export function results(
  t: Pick<Tournament, "buy_in" | "rebuy_price" | "addon_price">,
  entries: TournamentEntry[],
): { id: string; member_id: string; place: number; prize: number; cost: number; net: number }[] {
  const order = standings(entries);
  return order.map((id, i) => {
    const e = entries.find((x) => x.id === id)!;
    const cost = entryCost(t, e);
    const prize = Number(e.prize ?? 0);
    return { id, member_id: e.member_id, place: e.place ?? i + 1, prize, cost, net: round2(prize - cost) };
  });
}

// ---------------------------------------------------------------------------
// Table balancing
// ---------------------------------------------------------------------------

export type Move = { entry_id: string; from_table: number; to_table: number; to_seat: number; reason: "break" | "balance" };

/**
 * Moves that keep the tables even: when the players fit at one table fewer,
 * break the shortest table; otherwise, when two tables differ by 2 or more,
 * move one player from the longest to the shortest. Players are moved to the
 * lowest free seat. Returns [] when the tables are already balanced.
 */
export function balanceMoves(
  entries: Pick<TournamentEntry, "id" | "status" | "table_no" | "seat_no">[],
  tableCount: number,
  seatsPerTable: number,
): Move[] {
  const seats = new Map<number, { id: string; seat: number }[]>();
  for (let t = 1; t <= tableCount; t++) seats.set(t, []);
  for (const e of entries) if (e.status === "playing" && e.table_no) seats.get(e.table_no)?.push({ id: e.id, seat: e.seat_no ?? 0 });
  const moves: Move[] = [];
  const active = () => [...seats.entries()].filter(([, p]) => p.length > 0);
  const freeSeat = (t: number) => {
    const taken = new Set(seats.get(t)!.map((p) => p.seat));
    for (let s = 1; s <= seatsPerTable; s++) if (!taken.has(s)) return s;
    return null;
  };
  const move = (from: number, to: number, reason: Move["reason"]) => {
    const list = seats.get(from)!;
    const p = [...list].sort((a, b) => b.seat - a.seat)[0];
    const seat = freeSeat(to);
    if (!p || seat == null) return false;
    seats.set(from, list.filter((x) => x.id !== p.id));
    seats.get(to)!.push({ id: p.id, seat });
    moves.push({ entry_id: p.id, from_table: from, to_table: to, to_seat: seat, reason });
    return true;
  };
  const shortest = (except?: number) =>
    active()
      .filter(([t]) => t !== except)
      .sort((a, b) => a[1].length - b[1].length || a[0] - b[0])[0]?.[0];

  // break tables while everyone fits at one table fewer
  for (;;) {
    const act = active();
    const players = act.reduce((s, [, p]) => s + p.length, 0);
    if (act.length <= 1 || players > (act.length - 1) * seatsPerTable) break;
    // break the shortest table; on a tie, the highest numbered one (table 1 is the final table)
    const broken = act.sort((a, b) => a[1].length - b[1].length || b[0] - a[0])[0][0];
    while (seats.get(broken)!.length) {
      const to = shortest(broken);
      if (to == null || !move(broken, to, "break")) break;
    }
  }
  // even out
  for (let guard = 0; guard < 100; guard++) {
    const act = active().sort((a, b) => a[1].length - b[1].length || a[0] - b[0]);
    if (act.length < 2) break;
    const [minT, minP] = act[0];
    const [maxT, maxP] = act[act.length - 1];
    if (maxP.length - minP.length < 2) break;
    if (!move(maxT, minT, "balance")) break;
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

const dateLine = (s: string) =>
  `${new Date(s).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" })} בשעה ${new Date(s).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;

export function tournamentInviteText(t: Tournament, tableName: string, names: string[], waiting: number, link: string) {
  const cap = t.table_count * t.seats_per_table;
  const lines = [`🏆 ${t.name} - ${tableName}`, `📅 ${dateLine(t.starts_at)}`];
  if (t.location) lines.push(`🏠 מארח: ${t.location}`);
  if (t.address) lines.push(`📍 ${t.address}`, `🚗 ניווט בוויז: ${wazeUrl(t.address)}`);
  lines.push(`💰 כניסה ₪${Number(t.buy_in).toLocaleString()} · ${Number(t.starting_stack).toLocaleString()} צ'יפים`);
  if (t.rebuy_until_level > 0) lines.push(`🔁 ריביי עד סוף שלב ${t.rebuy_until_level}`);
  if (t.note) lines.push(`📝 ${t.note}`);
  lines.push("");
  if (names.length) {
    lines.push(`רשומים (${names.length}/${cap}):`);
    names.forEach((n, i) => lines.push(`${i + 1}. ${n}`));
    lines.push("");
  }
  if (waiting) lines.push(`${waiting} ברשימת המתנה`, "");
  if (!t.registration_open || t.status === "finished" || t.status === "cancelled") lines.push("ההרשמה סגורה.");
  else lines.push(names.length < cap ? `נשארו ${cap - names.length} מקומות. נרשמים כאן 👇` : "הטורניר מלא. אפשר להירשם לרשימת המתנה 👇", link);
  return lines.join("\n");
}

export function tournamentResultText(
  t: Tournament,
  rows: { name: string; place: number; prize: number; net: number }[],
  transfers: { from: string; to: string; amount: number }[],
) {
  const medal = (p: number) => (p === 1 ? "🥇" : p === 2 ? "🥈" : p === 3 ? "🥉" : `${p}.`);
  const money = (n: number) => `₪${Math.abs(round2(n)).toLocaleString()}`;
  const lines = [`🏆 ${t.name} - תוצאות`, ""];
  rows.filter((r) => r.prize > 0).forEach((r) => lines.push(`${medal(r.place)} ${r.name} · ${money(r.prize)}`));
  lines.push("", "מאזן:");
  rows.forEach((r) => lines.push(`${r.place}. ${r.name}: ${r.net >= 0 ? "+" : "-"}${money(r.net)}`));
  if (transfers.length) {
    lines.push("", "💸 מי מעביר למי:");
    transfers.forEach((x) => lines.push(`${x.from} ← ${x.to}: ${money(x.amount)}`));
  }
  return lines.join("\n");
}

/** Hebrew text for errors raised by the tournament functions */
export function tournamentError(msg: string) {
  if (msg.includes("registration is closed")) return "ההרשמה סגורה.";
  if (msg.includes("tournament already started")) return "הטורניר כבר התחיל.";
  if (msg.includes("need at least 2")) return "צריך לפחות 2 שחקנים רשומים.";
  if (msg.includes("removed from table")) return "הוסרת מהשולחן הזה.";
  if (msg.includes("no free seat")) return "אין כיסא פנוי. הוסיפו שולחן או פנו מקום.";
  if (msg.includes("last player")) return "זה השחקן האחרון. סיימו את הטורניר.";
  if (msg.includes("tournament not found")) return "הטורניר לא נמצא.";
  if (msg.includes("table is full")) return "השולחן מלא (עד 10 שחקנים).";
  return msg;
}

// ---------------------------------------------------------------------------
// Statistics over finished tournaments
// ---------------------------------------------------------------------------

export type TournamentStats = { member_id: string; played: number; wins: number; cashes: number; best: number; net: number; avgPlace: number };

export function tournamentStats(
  list: (Pick<Tournament, "status" | "buy_in" | "rebuy_price" | "addon_price"> & {
    entries: Pick<TournamentEntry, "member_id" | "place" | "prize" | "rebuys" | "addon">[];
  })[],
): TournamentStats[] {
  const map = new Map<string, TournamentStats & { places: number }>();
  for (const t of list) {
    if (t.status !== "finished") continue;
    for (const e of t.entries) {
      if (e.place == null) continue;
      const s = map.get(e.member_id) ?? { member_id: e.member_id, played: 0, wins: 0, cashes: 0, best: Infinity, net: 0, avgPlace: 0, places: 0 };
      s.played++;
      if (e.place === 1) s.wins++;
      if (Number(e.prize ?? 0) > 0) s.cashes++;
      s.best = Math.min(s.best, e.place);
      s.places += e.place;
      s.net = round2(s.net + Number(e.prize ?? 0) - entryCost(t, e));
      map.set(e.member_id, s);
    }
  }
  return [...map.values()]
    .map(({ places, ...s }) => ({ ...s, avgPlace: Math.round((places / s.played) * 10) / 10 }))
    .sort((a, b) => b.wins - a.wins || b.net - a.net);
}
