import { describe, expect, it } from "vitest";
import { seatMap, signupShareText, waitingList } from "../signup";
import type { Signup, SignupSeat } from "../types";

const signup: Signup = {
  id: "s1", table_id: "t", starts_at: "2026-11-19T19:00:00.000Z", location: "אצל יוסי", note: null, seats: 4,
  status: "open", night_id: null, created_by: null, created_at: "",
};
const p = (name: string, seat: number | null, created_at = "2026-11-12T10:00:00Z"): SignupSeat => ({
  member_id: name, seat, created_at, display_name: name, avatar_url: null, user_id: null,
});

describe("early sign-up", () => {
  it("maps seats by number, leaving free seats empty", () => {
    const m = seatMap([p("רון", 3), p("דנה", 1)], 4);
    expect(m.map((x) => x?.display_name ?? null)).toEqual(["דנה", null, "רון", null]);
  });

  it("orders the waiting list by sign-up time", () => {
    const w = waitingList([p("ב", null, "2026-11-12T11:00:00Z"), p("א", null, "2026-11-12T10:00:00Z"), p("ג", 1)]);
    expect(w.map((x) => x.display_name)).toEqual(["א", "ב"]);
  });

  it("share text lists who is in, free seats and the link", () => {
    const text = signupShareText("החבר'ה", signup, [p("דנה", 1), p("רון", 3)], "https://x/s/s1");
    expect(text).toContain("ערב פוקר - החבר'ה");
    expect(text).toContain("📍 אצל יוסי");
    expect(text).toContain("רשומים (2/4):");
    expect(text).toContain("1. דנה");
    expect(text).toContain("3. רון");
    expect(text).toContain("נשארו 2 מקומות");
    expect(text.endsWith("https://x/s/s1")).toBe(true);
  });

  it("share text offers the waiting list when full", () => {
    const text = signupShareText("T", { ...signup, seats: 2 }, [p("א", 1), p("ב", 2), p("ג", null)], "L");
    expect(text).toContain("השולחן מלא");
    expect(text).toContain("ממתינים: ג");
  });
});
