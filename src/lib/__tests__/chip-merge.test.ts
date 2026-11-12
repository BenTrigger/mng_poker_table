import { describe, expect, it } from "vitest";
import { mergeLearned } from "../chip-merge";
import type { Chip } from "../types";

const blob = () => new Blob(["x"], { type: "image/jpeg" });

describe("mergeLearned", () => {
  const current: (Chip & { newImages?: Blob[] })[] = [
    { color: "אדום", hex: "#ff0000", value: 5, images: ["t/a.jpg"] },
    { color: "ירוק", hex: "#00ff00", value: 25 },
  ];

  it("replaces an untouched default set", () => {
    const learned = [{ color: "כחול", hex: "#0000ff", value: 10, newImages: [blob()] }];
    expect(mergeLearned(current, learned, true)).toEqual(learned);
  });

  it("adds photos to the chip with the same value and keeps its name and stored photos", () => {
    const out = mergeLearned(current, [{ color: "אדום כהה", hex: "#aa0000", value: 5, desc: "red with white edge spots", newImages: [blob(), blob()] }], false);
    expect(out).toHaveLength(2);
    expect(out[0].color).toBe("אדום");
    expect(out[0].hex).toBe("#aa0000");
    expect(out[0].images).toEqual(["t/a.jpg"]);
    expect(out[0].newImages).toHaveLength(2);
    expect(out[0].desc).toBe("red with white edge spots");
  });

  it("appends a new value as a new chip with a unique name", () => {
    const out = mergeLearned(current, [{ color: "ירוק", hex: "#00aa00", value: 1000, newImages: [blob()] }], false);
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ color: "ירוק 2", value: 1000 });
  });
});
