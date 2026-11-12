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

if (typeof window !== "undefined") {
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

/** Shows the native install dialog. Resolves true if the user accepted. */
export async function promptInstall() {
  const e = deferred;
  if (!e) return false;
  await e.prompt();
  const { outcome } = await e.userChoice.catch(() => ({ outcome: "dismissed" }));
  deferred = null;
  emit();
  return outcome === "accepted";
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
