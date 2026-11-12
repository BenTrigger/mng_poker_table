import { NextResponse } from "next/server";
import type { supabaseServer } from "./supabase/server";

/** Records one paid AI call for the table; returns an error response when not allowed or over the daily cap. */
export async function checkAiQuota(sb: Awaited<ReturnType<typeof supabaseServer>>, tableId: string, kind: "count" | "learn") {
  const { error } = await sb.rpc("use_ai", { p_table: tableId, p_kind: kind });
  if (!error) return null;
  if (error.message.includes("quota exceeded")) {
    return NextResponse.json({ error: "הגעתם למכסת הזיהויים היומית של השולחן" }, { status: 429 });
  }
  if (error.message.includes("not allowed")) {
    return NextResponse.json({ error: kind === "learn" ? "רק מנהל השולחן יכול ללמד ערכה" : "רק הקופאי או המנהל סופרים מתמונה" }, { status: 403 });
  }
  return NextResponse.json({ error: "quota check failed" }, { status: 500 });
}
