import { NextResponse } from "next/server";
import { vapidKeys } from "@/lib/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The public VAPID key the browser needs to subscribe (null = push not available).
export async function GET() {
  const key = await vapidKeys()
    .then((k) => k.publicKey)
    .catch(() => null);
  return NextResponse.json({ key }, { headers: { "Cache-Control": "no-store" } });
}
