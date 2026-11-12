import { NextResponse } from "next/server";
import { vapidKeys } from "@/lib/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The public VAPID key the browser needs to subscribe (null = push not available).
export async function GET() {
  const key = await vapidKeys()
    .then((k) => k.publicKey)
    .catch((e) => {
      console.error("push key unavailable:", e instanceof Error ? e.message : e);
      return null;
    });
  return NextResponse.json({ key }, { headers: { "Cache-Control": "no-store" } });
}
