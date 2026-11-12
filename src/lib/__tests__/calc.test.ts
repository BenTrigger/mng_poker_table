import { describe, it, expect } from "vitest";
import { settle, chipCheck, playerLines, balanceNets, chipSetTotal, memberStats, chipRate } from "../calc";
import type { ChipRequest, NightPlayer } from "../types";

const night = { chips_per_buyin: 1000, money_per_buyin: 100 };

function req(member_id: string, chips: number, status: ChipRequest["status"] = "approved", given?: number): ChipRequest {
  return {
    id: Math.random().toString(), night_id: "n", member_id, requested_by: null, mode: "chips", chips,
    given_chips: given ?? null, detected_chips: null, status, photo_path: null, note: null,
    approved_by: null, approved_at: null, created_at: "",
  };
}
function player(member_id: string, final_chips: number | null): NightPlayer {
  return { id: member_id, night_id: "n", member_id, seat: 0, status: "playing", final_chips, final_photo_path: null, left_at: null, bought_money: null, net: null };
}

describe("calc", () => {
  it("chip rate", () => expect(chipRate(night)).toBe(0.1));

  it("player lines count only approved chips and use corrected amount", () => {
    const lines = playerLines(night, [player("a", 2500), player("b", null)], [
      req("a", 1000), req("a", 1000, "approved", 900), req("a", 500, "pending"), req("b", 1000, "rejected"),
    ]);
    expect(lines[0].boughtChips).toBe(1900);
    expect(lines[0].boughtMoney).toBe(190);
    expect(lines[0].pendingChips).toBe(500);
    expect(lines[0].net).toBe(60);
    expect(lines[1].boughtChips).toBe(0);
    expect(lines[1].net).toBeNull();
  });

  it("settle produces transfers that zero everyone", () => {
    const nets = [
      { id: "a", net: 150 }, { id: "b", net: -100 }, { id: "c", net: -80 }, { id: "d", net: 30 },
    ];
    const t = settle(nets);
    const bal = new Map(nets.map((n) => [n.id, n.net]));
    for (const x of t) {
      bal.set(x.from, bal.get(x.from)! + x.amount);
      bal.set(x.to, bal.get(x.to)! - x.amount);
    }
    for (const v of bal.values()) expect(Math.abs(v)).toBeLessThan(0.01);
    expect(t.length).toBeLessThanOrEqual(3);
  });

  it("balanceNets spreads a counting gap", () => {
    const out = balanceNets([
      { id: "a", net: 50, finalChips: 1500 },
      { id: "b", net: -40, finalChips: 500 },
    ]);
    expect(out.reduce((s, x) => s + x.net, 0)).toBeCloseTo(0, 2);
  });

  it("chipSetTotal", () => {
    expect(chipSetTotal([{ color: "red", count: 3 }, { color: "blue", count: 2 }], [
      { color: "red", value: 5 }, { color: "blue", value: 25 },
    ])).toBe(65);
  });

  it("memberStats", () => {
    const s = memberStats([
      { member_id: "a", net: 100, boughtMoney: 100 },
      { member_id: "a", net: -50, boughtMoney: 200 },
      { member_id: "b", net: -50, boughtMoney: 100 },
    ]);
    expect(s[0]).toMatchObject({ member_id: "a", nights: 2, total: 50, avg: 25, best: 100, worst: -50, wins: 1 });
  });
});

import { breakdown } from "../chips";
describe("breakdown", () => {
  it("sums to the requested chips", () => {
    const chips = [
      { color: "w", hex: "", value: 1 }, { color: "r", hex: "", value: 5 }, { color: "g", hex: "", value: 25 }, { color: "b", hex: "", value: 100 },
    ];
    for (const total of [1000, 500, 137, 25]) {
      const b = breakdown(total, chips);
      expect(b.reduce((s, r) => s + r.count * r.chip.value, 0)).toBe(total);
    }
  });
});
describe("balanceNets with fixed players", () => {
  it("includes fixed nets in the gap", () => {
    const out = balanceNets([{ id: "a", net: 100, finalChips: 1000 }], -60);
    expect(out[0].net).toBe(60);
  });
});

import { compareVersions, releasesSince, CHANGELOG } from "../changelog";
describe("versions", () => {
  it("compares semver", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("changelog is newest first and releasesSince filters", () => {
    for (let i = 1; i < CHANGELOG.length; i++) expect(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBe(1);
    expect(releasesSince(CHANGELOG[0].version)).toEqual([]);
  });

  it("chip check at handover: counted vs handed, players who left count by final chips", () => {
    const lines = [{ boughtChips: 2000 }, { boughtChips: 1000 }, { boughtChips: 1000 }];
    const players = [
      { member_id: "a", status: "playing" as const, final_chips: null },
      { member_id: "b", status: "playing" as const, final_chips: null },
      { member_id: "c", status: "out" as const, final_chips: 400 },
    ];
    expect(chipCheck(lines, players, { a: 2600, b: 1000 })).toEqual({ handed: 4000, counted: 4000, gap: 0 });
    expect(chipCheck(lines, players, { a: 2500, b: 1000 })).toEqual({ handed: 4000, counted: 3900, gap: -100 });
    // a player counted live is not double counted even if marked out
    expect(chipCheck(lines, players, { a: 2600, b: 1000, c: 400 }).counted).toBe(4000);
  });
});
