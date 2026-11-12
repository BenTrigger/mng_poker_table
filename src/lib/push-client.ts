"use client";
import { supabase } from "./supabase/client";
import { APP_BUILD } from "./changelog";
import { detectPlatform, isInstalled } from "./install-prompt";

/**
 * Phone push on the web. Android/desktop Chrome, Edge, Firefox: works in the
 * browser and in the installed app. iPhone/iPad: only in the app installed to
 * the home screen (iOS 16.4+), never in a Safari tab.
 */
export type PushState =
  | "unsupported"      // this browser cannot do web push
  | "ios-install"      // iPhone in Safari: install to the home screen first
  | "not-configured"   // the server has no VAPID keys yet
  | "denied"           // the user blocked notifications for the site
  | "off"
  | "on";

function supported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register(`/sw.js?v=${APP_BUILD}`);
}

let keyCache: Promise<string | null> | null = null;
function publicKey() {
  keyCache ??= fetch("/api/push/key", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { key: null }))
    .then((j: { key: string | null }) => j.key)
    .catch(() => null);
  return keyCache;
}

function urlB64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function save(sub: PushSubscription) {
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase().rpc("save_push_subscription", {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys.p256dh,
    p_auth: j.keys.auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return detectPlatform() === "ios" && !isInstalled() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (!(await publicKey())) return "not-configured";
  if (Notification.permission !== "granted") return "off";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** Asks for permission (must run from a tap) and subscribes this device. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return getPushState();
  const key = await publicKey();
  if (!key) return "not-configured";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // a subscription made with an older key cannot receive our messages
  const current = sub?.options?.applicationServerKey;
  if (sub && current && btoa(String.fromCharCode(...new Uint8Array(current))).replace(/=+$/, "") !==
      btoa(String.fromCharCode(...urlB64ToBytes(key))).replace(/=+$/, "")) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(key) });
  await save(sub);
  return "on";
}

export async function disablePush(): Promise<PushState> {
  if (!supported()) return getPushState();
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase().rpc("remove_push_subscription", { p_endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}

/** On app start: keep this device linked to whoever is signed in now. */
export async function refreshPushLink() {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await save(sub);
  } catch {
    // best effort
  }
}

export async function sendTestPush(): Promise<{ ok: boolean; devices?: number }> {
  const r = await fetch("/api/push/test", { method: "POST" });
  if (!r.ok) return { ok: false };
  const j = (await r.json()) as { sent: number; devices: number };
  return { ok: j.sent > 0, devices: j.devices };
}
