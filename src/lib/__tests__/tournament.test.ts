import { describe, expect, it } from "vitest";
import {
  anchorFor, balanceMoves, blindStructure, chipsInPlay, clockState, entryCost, niceRound, payoutPercents, prizePool, prizes, results,
  standings, togglePause, tournamentInviteText, tournamentStats,
} from "../tournament";
import type { Tournament, TournamentEntry } from "../types";

const levels = blindStructure(10000, 20);
const T: Tournament = {
  id: "t1", table_id: "tb", name: "טורניר חמישי", starts_at: "2026-11-20T18:00:00.000Z", location: null, address: null, note: null,
  table_count: 2, seats_per_table: 9, buy_in: 100, starting_stack: 10000, rebuy_until_level: 4, rebuy_price: null, rebuy_chips: null,
  addon_price: 50, addon_chips: 5000, late_reg_until_level: 4, levels, registration_open: true, status: "running",
  clock_anchor: "2026-11-20T18:00:00.000Z", paused_at: null, started_at: null, finished_at: null, created_by: null, created_at: "",
};
let n = 0;
const E = (p: Partial<TournamentEntry> = {}): TournamentEntry => ({
  id: `e${++n}`, tournament_id: "t1", member_id: `m${n}`, status: "playing", table_no: 1, seat_no: n, rebuys: 0, addon: false,
  busted_at: null, busted_by: null, place: null, prize: null, created_at: `2026-11-20T17:00:0${n % 10}Z`, ...p,
});
const at = (min: number) => new Date("2026-11-20T18:00:00.000Z").getTime() + min * 60_000;

describe("blind structure", () => {
  it("starts 200 big blinds deep and keeps going up", () => {
    expect(levels[0]).toMatchObject({ sb: 25, bb: 50, minutes: 20 });
    const play = levels.filter((l) => !l.break);
    for (let i = 1; i < play.length; i++) expect(play[i].bb!).toBeGreaterThan(play[i - 1].bb!);
  });
  it("has breaks after levels 4 and 8 and an ante from level 7", () => {
    expect(levels[4]).toMatchObject({ break: true, minutes: 10 });
    expect(levels[9]).toMatchObject({ break: true });
    const play = levels.filter((l) => !l.break);
    expect(play[5].ante).toBe(0);
    expect(play[6].ante).toBe(play[6].bb);
  });
  it("scales with the starting stack", () => {
    expect(blindStructure(1000, 15)[0]).toMatchObject({ sb: 2, bb: 5 });
    expect(blindStructure(20000, 15)[0]).toMatchObject({ sb: 50, bb: 100 });
  });
  it("rounds to nice chip amounts", () => {
    expect(niceRound(47)).toBe(50);
    expect(niceRound(1180)).toBe(1000);
    expect(niceRound(0.3)).toBe(1);
  });
});

describe("clock", () => {
  it("finds the level by elapsed time, skipping into breaks", () => {
    expect(clockState(T, at(5))).toMatchObject({ index: 0, levelNo: 1, remainingMs: 15 * 60_000 });
    expect(clockState(T, at(85))).toMatchObject({ index: 4, levelNo: 4 }); // the break after level 4
    expect(clockState(T, at(85))!.level.break).toBe(true);
    expect(clockState(T, at(91))).toMatchObject({ index: 5, levelNo: 5 });
  });
  it("freezes while paused and resumes where it stopped", () => {
    const paused = { ...T, ...togglePause(T, at(10)) } as Tournament;
    expect(clockState(paused, at(50))!.remainingMs).toBe(10 * 60_000);
    const resumed = { ...paused, ...togglePause(paused, at(50)) } as Tournament;
    expect(resumed.paused_at).toBeNull();
    expect(clockState(resumed, at(55))!.remainingMs).toBe(5 * 60_000);
  });
  it("jumps to the start of another level", () => {
    const next = { ...T, clock_anchor: anchorFor(T, 2, at(7)) };
    expect(clockState(next, at(7))).toMatchObject({ index: 2, elapsedMs: 0 });
  });
});

describe("money", () => {
  it("counts buy-ins, rebuys and add-ons in the pool and in chips", () => {
    const es = [E({ rebuys: 2 }), E({ addon: true }), E({ status: "busted" }), E({ status: "waiting" })];
    expect(entryCost(T, es[0])).toBe(300);
    expect(prizePool(T, es)).toBe(300 + 150 + 100);
    expect(chipsInPlay(T, es)).toBe(30000 + 15000 + 10000);
  });
  it("pays more places as the field grows", () => {
    expect(payoutPercents(4)).toEqual([100]);
    expect(payoutPercents(6)).toHaveLength(2);
    expect(payoutPercents(9)).toEqual([50, 30, 20]);
    expect(payoutPercents(18)).toHaveLength(4);
  });
  it("prizes add up to the pool exactly", () => {
    for (const [pool, players] of [[900, 9], [1150, 9], [730, 7], [2470, 19], [55, 3]] as const) {
      const p = prizes(pool, players);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(pool, 5);
      for (let i = 1; i < p.length; i++) expect(p[i]).toBeLessThanOrEqual(p[i - 1]);
    }
    expect(prizes(900, 9)).toEqual([450, 270, 180]);
  });
});

describe("standings and results", () => {
  it("ranks players still in first, then the latest bust", () => {
    const a = E();
    const b = E({ status: "busted", busted_at: "2026-11-20T19:00:00Z" });
    const c = E({ status: "busted", busted_at: "2026-11-20T20:00:00Z" });
    expect(standings([b, a, c])).toEqual([a.id, c.id, b.id]);
  });
  it("uses stored places once the tournament is over", () => {
    const a = E({ status: "busted", place: 2, prize: 200 });
    const b = E({ status: "busted", place: 1, prize: 200, rebuys: 1 });
    const c = E({ status: "busted", place: 3, prize: 0 });
    const r = results({ ...T, addon_price: null }, [a, b, c]);
    expect(r.map((x) => x.place)).toEqual([1, 2, 3]);
    expect(r[0].net).toBe(0); // won 200, paid 200
    expect(r.reduce((s, x) => s + x.net, 0)).toBe(0);
  });
});

describe("table balancing", () => {
  const seated = (table: number, count: number) => Array.from({ length: count }, (_, i) => E({ table_no: table, seat_no: i + 1 }));
  it("does nothing when the tables are even", () => {
    expect(balanceMoves([...seated(1, 7), ...seated(2, 6)], 2, 9)).toEqual([]);
  });
  it("moves a player from the long table to the short one", () => {
    const moves = balanceMoves([...seated(1, 8), ...seated(2, 6)], 2, 9);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from_table: 1, to_table: 2, to_seat: 7, reason: "balance" });
  });
  it("breaks a table when everyone fits at one table fewer (final table)", () => {
    const moves = balanceMoves([...seated(1, 5), ...seated(2, 4)], 2, 9);
    expect(moves).toHaveLength(4);
    expect(moves.every((m) => m.from_table === 2 && m.to_table === 1 && m.reason === "break")).toBe(true);
    expect(new Set(moves.map((m) => m.to_seat)).size).toBe(4);
  });
  it("spreads a broken table over the others", () => {
    const moves = balanceMoves([...seated(1, 7), ...seated(2, 7), ...seated(3, 3)], 3, 9);
    const to = moves.map((m) => m.to_table);
    expect(to.filter((x) => x === 1).length + to.filter((x) => x === 2).length).toBe(3);
    expect(moves.every((m) => m.from_table === 3)).toBe(true);
  });
});

describe("sharing and stats", () => {
  it("invite text has the details, the count and the link", () => {
    const text = tournamentInviteText({ ...T, status: "registration" }, "החבר'ה", ["דנה", "רון"], 1, "https://x/tr/t1");
    expect(text).toContain("🏆 טורניר חמישי - החבר'ה");
    expect(text).toContain("כניסה ₪100");
    expect(text).toContain("רשומים (2/18):");
    expect(text).toContain("1 ברשימת המתנה");
    expect(text).toContain("https://x/tr/t1");
  });
  it("leaderboard counts wins, cashes and net", () => {
    const fin = { ...T, status: "finished" as const, addon_price: null };
    const s = tournamentStats([
      { ...fin, entries: [{ member_id: "a", place: 1, prize: 300, rebuys: 0, addon: false }, { member_id: "b", place: 2, prize: 0, rebuys: 1, addon: false }] },
      { ...fin, entries: [{ member_id: "b", place: 1, prize: 200, rebuys: 0, addon: false }, { member_id: "a", place: 2, prize: 0, rebuys: 0, addon: false }] },
      { ...T, entries: [{ member_id: "a", place: null, prize: null, rebuys: 0, addon: false }] }, // still running: ignored
    ]);
    const a = s.find((x) => x.member_id === "a")!;
    expect(a).toMatchObject({ played: 2, wins: 1, cashes: 1, best: 1, net: 100, avgPlace: 1.5 });
    expect(s.find((x) => x.member_id === "b")!.net).toBe(-100);
  });
});
