import { NextResponse } from "next/server";
import { dispatchPending, dispatchSecret } from "@/lib/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Pinged by the database (pg_net) right after notifications are written,
// with the shared secret stored in app_meta.config.
export async function POST(req: Request) {
  try {
    const secret = await dispatchSecret();
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json(await dispatchPending());
  } catch (e) {
    console.error("[push] dispatch failed", (e as Error).message);
    return NextResponse.json({ error: "dispatch failed" }, { status: 500 });
  }
}
