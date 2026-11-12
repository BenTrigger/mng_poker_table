import { describe, expect, it } from "vitest";
import { timeAgo } from "../notifications";

describe("timeAgo", () => {
  const now = new Date("2026-11-12T20:00:00Z").getTime();
  const ago = (ms: number) => timeAgo(new Date(now - ms).toISOString(), now);
  it("reads naturally in Hebrew", () => {
    expect(ago(10_000)).toBe("עכשיו");
    expect(ago(60_000)).toBe("לפני דקה");
    expect(ago(12 * 60_000)).toBe("לפני 12 דק׳");
    expect(ago(3600_000)).toBe("לפני שעה");
    expect(ago(2 * 3600_000)).toBe("לפני שעתיים");
    expect(ago(5 * 3600_000)).toBe("לפני 5 שעות");
    expect(ago(30 * 3600_000)).toBe("אתמול");
    expect(ago(3 * 86400_000)).toBe("לפני 3 ימים");
  });
  it("never shows the future", () => {
    expect(timeAgo(new Date(now + 60_000).toISOString(), now)).toBe("עכשיו");
  });
});
