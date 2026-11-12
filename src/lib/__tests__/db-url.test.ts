import { describe, expect, it } from "vitest";
import { withoutSslMode } from "../db-url";

describe("withoutSslMode", () => {
  it("keeps the database name and other params of a pooler URL", () => {
    const u = new URL(withoutSslMode("postgres://u.ref:p%40w@pooler.example.com:6543/postgres?sslmode=require&supa=base-pooler.x"));
    expect(u.pathname).toBe("/postgres");
    expect(u.searchParams.get("sslmode")).toBeNull();
    expect(u.searchParams.get("supa")).toBe("base-pooler.x");
    expect(decodeURIComponent(u.password)).toBe("p@w");
  });
  it("handles a URL with only sslmode or none", () => {
    expect(new URL(withoutSslMode("postgres://u:p@h:5432/db?sslmode=require")).pathname).toBe("/db");
    expect(withoutSslMode("postgres://u:p@h:5432/db")).toBe("postgres://u:p@h:5432/db");
  });
});
