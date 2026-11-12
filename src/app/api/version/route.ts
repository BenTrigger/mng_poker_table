import { NextResponse } from "next/server";
import { APP_BUILD, APP_VERSION } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: APP_VERSION, build: APP_BUILD },
    { headers: { "Cache-Control": "no-store" } },
  );
}
