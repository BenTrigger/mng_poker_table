import { NextResponse } from "next/server";

// Digital Asset Links for the Android app (TWA), so it opens full screen
// without a browser bar. Set ANDROID_CERT_SHA256 (colon separated) in the
// Vercel environment once the APK signing key exists.
export const dynamic = "force-dynamic";

export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const pkg = process.env.ANDROID_PACKAGE ?? "com.realizeaisolution.pokertable";
  return NextResponse.json(
    fingerprints.length
      ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: fingerprints } }]
      : [],
  );
}
