"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useNotifications } from "@/lib/notifications";
import { refreshPushLink } from "@/lib/push-client";

/** Bell with an unread count; opens the recent notifications list. Hidden when signed out. */
export function NotificationBell() {
  const [uid, setUid] = useState<string | null>(null);
  const { unread, markRead } = useNotifications(uid, 30);

  useEffect(() => {
    let alive = true;
    supabase()
      .auth.getSession()
      .then(({ data }) => alive && setUid(data.session?.user.id ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // arrived from a phone notification (?n=123): that one is read now
  useEffect(() => {
    if (!uid) return;
    refreshPushLink();
    const n = Number(new URLSearchParams(location.search).get("n"));
    if (n) markRead([n]);
  }, [uid, markRead]);

  // number on the installed app's icon
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!uid) return;
    if (unread > 0) nav.setAppBadge?.(unread).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [uid, unread]);

  if (!uid) return null;
  return (
    <Link
      href="/notifications"
      className="relative rounded-full p-2 text-muted hover:bg-white/5"
      aria-label={unread ? `התראות, ${unread} חדשות` : "התראות"}
      data-testid="notification-bell"
    >
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="num absolute -left-0.5 -top-0.5 grid min-w-[1.15rem] place-items-center rounded-full bg-loss px-1 text-[0.65rem] font-extrabold leading-[1.15rem] text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
