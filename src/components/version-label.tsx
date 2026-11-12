"use client";
import Link from "next/link";
import { APP_BUILD, APP_VERSION } from "@/lib/changelog";
import { openWhatsNew } from "./update-watcher";

export function VersionLabel() {
  return (
    <div className="flex items-center justify-center gap-3 py-6 text-xs text-muted">
      <button onClick={openWhatsNew} className="num hover:text-gold">
        גרסה {APP_VERSION} ({APP_BUILD}) · מה חדש
      </button>
      <span>·</span>
      <Link href="/install" className="hover:text-gold">
        התקנת האפליקציה
      </Link>
    </div>
  );
}
