/**
 * Keeps the browser's "install app" prompt (Android Chrome / desktop Chrome)
 * so any screen can offer one-tap install. The event fires once, early, so it
 * is caught here as soon as the layout loads, not by the screen that shows it.
 */
export type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
export type Platform = "ios" | "android" | "desktop";

let deferred: BIPEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

type EarlyWindow = Window & { __bip?: BIPEvent | null };

if (typeof window !== "undefined") {
  // An inline script in <head> (see layout) catches the event even if it fires
  // before this bundle has loaded.
  const early = (window as EarlyWindow).__bip;
  if (early) deferred = early;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BIPEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export function subscribeInstall(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
export const getInstallPrompt = () => deferred;

/** Waits up to `ms` for the browser to offer an install prompt (it can arrive a moment after load). */
export function waitForInstallPrompt(ms = 2500): Promise<BIPEvent | null> {
  if (deferred) return Promise.resolve(deferred);
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      off();
      resolve(deferred);
    }, ms);
    const off = subscribeInstall(() => {
      if (!deferred) return;
      clearTimeout(t);
      off();
      resolve(deferred);
    });
  });
}

/**
 * Tries the browser's own install dialog.
 * "accepted" = installing, "dismissed" = the user closed it, "unavailable" = the browser offers no install.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = await waitForInstallPrompt();
  if (!e) return "unavailable";
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "unavailable";
  } finally {
    // a prompt can be shown only once
    deferred = null;
    (window as EarlyWindow).__bip = null;
    emit();
  }
}

export function detectPlatform(ua = navigator.userAgent): Platform {
  // iPadOS reports itself as a Mac; touch support gives it away
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/i.test(ua) ? "android" : "desktop";
}

export function isInstalled() {
  if (installed) return true;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
