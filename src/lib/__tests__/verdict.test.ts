import { describe, expect, it } from "vitest";
import { verdictOf } from "../verdict";

describe("hand-over verdict from the side photo", () => {
  it("verified when the photo matches with a clear count", () => {
    expect(verdictOf(1000, 1000, false)).toMatchObject({ tone: "win", title: "מאומת" });
  });
  it("pay attention when it matches but the photo is unclear", () => {
    expect(verdictOf(1000, 1000, true)).toMatchObject({ tone: "warn", title: "שים לב" });
  });
  it("gave more / gave less", () => {
    expect(verdictOf(1000, 1100, false).title).toBe("נתת יותר ב־100");
    expect(verdictOf(1000, 950, false).title).toBe("נתת פחות ב־50");
  });
});
