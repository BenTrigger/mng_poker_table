"use client";
import { useEffect } from "react";
import { APP_BUILD } from "@/lib/changelog";

export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    // a new build id means a new service worker (and a fresh cache)
    navigator.serviceWorker.register(`/sw.js?v=${APP_BUILD}`).catch(() => {});
  }, []);
  return null;
}
