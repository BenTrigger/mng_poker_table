"use client";
import { useEffect, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { APP_BUILD, APP_VERSION, CHANGELOG, releasesSince, type Release } from "@/lib/changelog";
import { Sheet, Button } from "./ui";

const SEEN_KEY = "allin:seen-version";
const CHECK_EVERY_MS = 5 * 60 * 1000;

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {}
}

/** Opens the "what's new" sheet from anywhere (e.g. the version label). */
export function openWhatsNew() {
  window.dispatchEvent(new CustomEvent("allin:whats-new"));
}

/**
 * 1. Polls /api/version; when a newer deploy is live, shows an "update" banner.
 * 2. After an update, shows "what's new" once with the release notes.
 */
export function UpdateWatcher() {
  const [updateReady, setUpdateReady] = useState(false);
  const [notes, setNotes] = useState<Release[] | null>(null);

  useEffect(() => {
    if (APP_BUILD === "dev") return;
    const seen = read(SEEN_KEY);
    if (seen !== APP_VERSION) {
      const fresh = releasesSince(seen);
      // first install: just remember the version quietly
      if (seen && fresh.length) setNotes(fresh);
      write(SEEN_KEY, APP_VERSION);
    }

    let stop = false;
    async function check() {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const j = await r.json();
        if (!stop && j.build && j.build !== APP_BUILD) setUpdateReady(true);
      } catch {}
    }
    const id = setInterval(check, CHECK_EVERY_MS);
    const vis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", vis);
    check();
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  useEffect(() => {
    const open = () => setNotes(CHANGELOG);
    window.addEventListener("allin:whats-new", open);
    return () => window.removeEventListener("allin:whats-new", open);
  }, []);

  async function applyUpdate() {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update().catch(() => {});
    location.reload();
  }

  return (
    <>
      {updateReady && (
        <div className="fixed inset-x-0 top-0 z-[70] flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <button onClick={applyUpdate} className="glass flex items-center gap-2 rounded-2xl border border-gold/40 px-4 py-2.5 text-sm font-bold text-gold shadow-lg">
            <RefreshCw className="size-4" /> גרסה חדשה זמינה. לחץ לעדכון
          </button>
        </div>
      )}
      <Sheet open={!!notes && notes.length > 0} onClose={() => setNotes(null)} title="מה חדש">
        <div className="space-y-5">
          {notes?.map((r) => (
            <div key={r.version}>
              <div className="flex items-baseline gap-2">
                <Sparkles className="size-4 text-gold" />
                <span className="font-bold">{r.title}</span>
                <span className="num text-xs text-muted">
                  v{r.version} · {new Date(r.date).toLocaleDateString("he-IL")}
                </span>
              </div>
              <ul className="mt-2 list-disc space-y-1 pr-6 text-sm text-ink/90">
                {r.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
          <Button className="w-full" onClick={() => setNotes(null)}>
            יאללה
          </Button>
        </div>
      </Sheet>
    </>
  );
}
