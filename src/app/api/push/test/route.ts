import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { sendTest } from "@/lib/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Send me a test": only ever reaches the caller's own devices.
export async function POST() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await sendTest(data.user.id));
  } catch (e) {
    console.error("[push] test failed", (e as Error).message);
    return NextResponse.json({ error: "send failed" }, { status: 500 });
  }
}
