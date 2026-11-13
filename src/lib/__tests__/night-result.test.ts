import { describe, it, expect } from "vitest";
import { foodCharges, nightResult } from "../calc";

const rate = 50 / 1500; // last night's table: 1,500 chips = ₪50
const sum = (xs: { net: number }[]) => Math.round(xs.reduce((s, x) => s + x.net, 0) * 100) / 100;

describe("food fee", () => {
  it("everyone but the host pays, the host receives it all", () => {
    expect(foodCharges(["a", "b", "h"], 50, "h")).toEqual({ a: -50, b: -50, h: 100 });
  });
  it("a host who does not play still receives", () => {
    expect(foodCharges(["a", "b"], 50, "h")).toEqual({ a: -50, b: -50, h: 100 });
  });
  it("no fee or no host: nothing", () => {
    expect(foodCharges(["a", "b"], 0, "a")).toEqual({});
    expect(foodCharges(["a", "b"], 50, null)).toEqual({});
  });
});

describe("nightResult", () => {
  it("keeps poker results apart from the food fee and still balances", () => {
    const r = nightResult(
      [
        { id: "a", status: "out", finalChips: 0, boughtMoney: 100 },
        { id: "b", status: "playing", finalChips: 6000, boughtMoney: 50 },
        { id: "h", status: "playing", finalChips: 1500, boughtMoney: 100 },
      ],
      rate,
      { foodFee: 50, hostId: "h" },
    );
    expect(r.poker).toEqual(expect.arrayContaining([{ id: "a", net: -100 }, { id: "b", net: 150 }, { id: "h", net: -50 }]));
    expect(r.nets).toEqual(expect.arrayContaining([{ id: "a", net: -150 }, { id: "b", net: 100 }, { id: "h", net: 50 }]));
    expect(sum(r.poker)).toBe(0);
    expect(sum(r.nets)).toBe(0);
    expect(Math.round(r.transfers.reduce((s, t) => s + t.amount, 0))).toBe(150);
  });

  it("all players out (everyone cashed out): results stay as counted", () => {
    const r = nightResult(
      [
        { id: "a", status: "out", finalChips: 12000, boughtMoney: 400 },
        { id: "b", status: "out", finalChips: 0, boughtMoney: 400 },
        { id: "c", status: "out", finalChips: 24000, boughtMoney: 400 },
      ],
      rate,
    );
    expect(r.poker.find((p) => p.id === "a")!.net).toBe(0);
    expect(sum(r.poker)).toBe(0);
  });

  it("through the cashier: everyone settles with the cashier, food included", () => {
    const r = nightResult(
      [
        { id: "c", status: "playing", finalChips: 3000, boughtMoney: 100 },
        { id: "a", status: "playing", finalChips: 0, boughtMoney: 100 },
        { id: "b", status: "playing", finalChips: 3000, boughtMoney: 0 },
      ],
      rate,
      { foodFee: 50, hostId: "b", mode: "cashier", cashierId: "c" },
    );
    expect(r.transfers).toEqual(expect.arrayContaining([
      { from: "a", to: "c", amount: 150 },
      { from: "c", to: "b", amount: 200 },
    ]));
  });

  it("a corrected count changes the result (11,000 counted instead of 12,000)", () => {
    const rows = (chips: number) => [
      { id: "h", status: "out" as const, finalChips: chips, boughtMoney: 400 },
      { id: "x", status: "out" as const, finalChips: 12000, boughtMoney: 400 },
    ];
    expect(nightResult(rows(11000), rate).poker.find((p) => p.id === "h")!.net).toBe(-33.33);
    expect(nightResult(rows(12000), rate).poker.find((p) => p.id === "h")!.net).toBe(0);
  });
});
