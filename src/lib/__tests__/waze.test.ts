import { describe, expect, it } from "vitest";
import { wazeUrl } from "../waze";

describe("waze link", () => {
  it("navigates to exact coordinates when the address was found", () => {
    expect(wazeUrl("הר בוקר 56, אופקים", { lat: 31.3141, lng: 34.6203 })).toBe(
      "https://www.waze.com/ul?ll=31.314100%2C34.620300&navigate=yes&zoom=17",
    );
  });
  it("falls back to an encoded search", () => {
    expect(wazeUrl("הר בוקר 56, אופקים")).toBe(
      `https://www.waze.com/ul?q=${encodeURIComponent("הר בוקר 56, אופקים")}&navigate=yes`,
    );
  });
});
