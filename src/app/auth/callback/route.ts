import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/tables";
  if (code) {
    const sb = await supabaseServer();
    await sb.auth.exchangeCodeForSession(code);
  }
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/tables";
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
