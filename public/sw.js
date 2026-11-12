// Minimal service worker: caches the app shell so the PWA opens fast and
// installs cleanly. Data always comes from the network (it is live).
const CACHE = "allin-" + (new URL(self.location).searchParams.get("v") || "v1");
const SHELL = ["/tables", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  // static assets: cache first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) => hit || fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }),
      ),
    );
    return;
  }
  // pages: network first, fall back to cache when offline
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then((r) => r || caches.match("/tables"))));
  }
});

// ---------------------------------------------------------------------------
// Push notifications (game starting, details changed, a seat opened...)
// ---------------------------------------------------------------------------
self.addEventListener("push", (e) => {
  let msg = {};
  try {
    msg = e.data ? e.data.json() : {};
  } catch {
    msg = { title: "All In", body: e.data ? e.data.text() : "" };
  }
  const url = msg.url || "/notifications";
  e.waitUntil(
    (async () => {
      await self.registration.showNotification(msg.title || "All In", {
        body: msg.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: msg.tag,
        dir: "rtl",
        lang: "he",
        data: { url, id: msg.id },
      });
      // a dot / number on the app icon where the phone supports it
      try {
        const shown = await self.registration.getNotifications();
        if (self.navigator.setAppBadge) await self.navigator.setAppBadge(shown.length || 1);
      } catch {}
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  let target = d.url || "/notifications";
  if (d.id) target += (target.includes("?") ? "&" : "?") + "n=" + d.id; // marks it read on arrival
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.focus();
          if ("navigate" in w) return w.navigate(target);
          return;
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});

// the browser renewed the subscription: the next app start saves the new one
self.addEventListener("pushsubscriptionchange", () => {});
