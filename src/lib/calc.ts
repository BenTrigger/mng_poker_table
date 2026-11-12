import type { ChipRequest, NightPlayer, GameNight } from "./types";

/** Money value of a single chip unit for the night. */
export function chipRate(night: Pick<GameNight, "chips_per_buyin" | "money_per_buyin">): number {
  if (!night.chips_per_buyin) return 0;
  return Number(night.money_per_buyin) / Number(night.chips_per_buyin);
}

export function chipsToMoney(chips: number, rate: number): number {
  return round2(chips * rate);
}

export function moneyToChips(money: number, rate: number): number {
  if (!rate) return 0;
  return Math.round(money / rate);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Chips counted toward a player's debt for this request. */
export function countedChips(r: Pick<ChipRequest, "status" | "given_chips" | "chips">): number {
  if (r.status !== "approved") return 0;
  return Number(r.given_chips ?? r.chips);
}

export type PlayerLine = {
  member_id: string;
  boughtChips: number;
  boughtMoney: number;
  buyins: number;
  finalChips: number | null;
  cashoutMoney: number | null;
  net: number | null; // positive = won
  status: NightPlayer["status"];
  pendingChips: number;
};

export function playerLines(
  night: Pick<GameNight, "chips_per_buyin" | "money_per_buyin">,
  players: NightPlayer[],
  requests: ChipRequest[],
): PlayerLine[] {
  const rate = chipRate(night);
  return players.map((p) => {
    const mine = requests.filter((r) => r.member_id === p.member_id);
    const boughtChips = mine.reduce((s, r) => s + countedChips(r), 0);
    const pendingChips = mine
      .filter((r) => r.status === "pending" || r.status === "flagged")
      .reduce((s, r) => s + Number(r.chips), 0);
    const boughtMoney = chipsToMoney(boughtChips, rate);
    const finalChips = p.final_chips == null ? null : Number(p.final_chips);
    const cashoutMoney = finalChips == null ? null : chipsToMoney(finalChips, rate);
    return {
      member_id: p.member_id,
      boughtChips,
      boughtMoney,
      buyins: night.chips_per_buyin ? boughtChips / Number(night.chips_per_buyin) : 0,
      finalChips,
      cashoutMoney,
      net: cashoutMoney == null ? null : round2(cashoutMoney - boughtMoney),
      status: p.status,
      pendingChips,
    };
  });
}

/**
 * Chip check at a point in the night (cashier handover or close):
 * chips handed out vs chips counted on the table plus chips of players who left.
 * gap > 0 means more chips than recorded (surplus), gap < 0 means missing chips.
 */
export function chipCheck(
  lines: Pick<PlayerLine, "boughtChips">[],
  players: Pick<NightPlayer, "member_id" | "status" | "final_chips">[],
  liveCounts: Record<string, number>,
): { handed: number; counted: number; gap: number } {
  const handed = lines.reduce((s, l) => s + l.boughtChips, 0);
  const outChips = players
    .filter((p) => p.status === "out" && liveCounts[p.member_id] == null)
    .reduce((s, p) => s + Number(p.final_chips ?? 0), 0);
  const counted = outChips + Object.values(liveCounts).reduce((s, c) => s + c, 0);
  return { handed, counted, gap: counted - handed };
}

export type Transfer = { from: string; to: string; amount: number };

/**
 * Minimal-ish set of transfers so that everyone ends at zero.
 * Greedy: biggest debtor pays biggest creditor. Produces at most n-1 transfers.
 */
export function settle(nets: { id: string; net: number }[]): Transfer[] {
  const debtors = nets
    .filter((n) => n.net < -0.004)
    .map((n) => ({ id: n.id, amt: -n.net }))
    .sort((a, b) => b.amt - a.amt);
  const creditors = nets
    .filter((n) => n.net > 0.004)
    .map((n) => ({ id: n.id, amt: n.net }))
    .sort((a, b) => b.amt - a.amt);
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0.004) out.push({ from: debtors[i].id, to: creditors[j].id, amount: round2(pay) });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt < 0.005) i++;
    if (creditors[j].amt < 0.005) j++;
  }
  return out;
}

/**
 * When counted chips at the end differ from chips handed out, spread the
 * difference across players proportionally to their final stacks so the
 * night balances to zero. Returns adjusted nets.
 */
export function balanceNets(lines: { id: string; net: number; finalChips: number }[], fixedTotal = 0) {
  const totalNet = lines.reduce((s, l) => s + l.net, 0) + fixedTotal;
  if (Math.abs(totalNet) < 0.005 || lines.length === 0) return lines.map((l) => ({ id: l.id, net: round2(l.net) }));
  const totalFinal = lines.reduce((s, l) => s + l.finalChips, 0);
  return lines.map((l) => {
    const share = totalFinal > 0 ? l.finalChips / totalFinal : 1 / lines.length;
    return { id: l.id, net: round2(l.net - totalNet * share) };
  });
}

export function chipSetTotal(counts: { color: string; count: number }[], chips: { color: string; value: number }[]) {
  return counts.reduce((s, c) => {
    const chip = chips.find((x) => x.color === c.color);
    return s + (chip ? chip.value * c.count : 0);
  }, 0);
}

/** Isolate as left-to-right so signs and ₪ stay in place inside Hebrew text. */
const ltr = (s: string) => `\u2066${s}\u2069`;

export function formatMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = round2(n);
  const s = Math.abs(v).toLocaleString("he-IL", { maximumFractionDigits: 2 });
  return ltr(`${v < 0 ? "-" : ""}₪${s}`);
}

export function formatSigned(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) < 0.005) return ltr("₪0");
  return ltr(`${n > 0 ? "+" : "-"}₪${Math.abs(round2(n)).toLocaleString("he-IL", { maximumFractionDigits: 2 })}`);
}

export type MemberStats = {
  member_id: string;
  nights: number;
  total: number;
  avg: number;
  best: number;
  worst: number;
  wins: number;
  buyinsTotal: number;
};

export function memberStats(
  rows: { member_id: string; net: number; boughtMoney: number }[],
): MemberStats[] {
  const map = new Map<string, MemberStats>();
  for (const r of rows) {
    const s =
      map.get(r.member_id) ??
      { member_id: r.member_id, nights: 0, total: 0, avg: 0, best: -Infinity, worst: Infinity, wins: 0, buyinsTotal: 0 };
    s.nights++;
    s.total = round2(s.total + r.net);
    s.best = Math.max(s.best, r.net);
    s.worst = Math.min(s.worst, r.net);
    if (r.net > 0) s.wins++;
    s.buyinsTotal = round2(s.buyinsTotal + r.boughtMoney);
    map.set(r.member_id, s);
  }
  return [...map.values()]
    .map((s) => ({ ...s, avg: round2(s.total / s.nights) }))
    .sort((a, b) => b.total - a.total);
}
