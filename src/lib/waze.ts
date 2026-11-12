import { useEffect, useState } from "react";

export type LatLng = { lat: number; lng: number };

/**
 * Waze deep link. With coordinates Waze starts navigation to that exact point;
 * a free-text search ("q=") is only the fallback, because the Waze app often
 * opens without filling in a Hebrew address.
 */
export function wazeUrl(address: string, at?: LatLng | null) {
  if (at) return `https://www.waze.com/ul?ll=${at.lat.toFixed(6)}%2C${at.lng.toFixed(6)}&navigate=yes&zoom=17`;
  return `https://www.waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

const cache = new Map<string, LatLng | null>();

/** Coordinates for an address (null while loading or when not found) */
export function useGeocode(address: string | null | undefined) {
  const key = address?.trim() ?? "";
  const [at, setAt] = useState<LatLng | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    if (!key) return setAt(null);
    if (cache.has(key)) return setAt(cache.get(key) ?? null);
    let live = true;
    fetch(`/api/geocode?q=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { lat: number | null; lng: number | null } | null) => {
        const v = j && j.lat != null && j.lng != null ? { lat: j.lat, lng: j.lng } : null;
        cache.set(key, v);
        if (live) setAt(v);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key]);
  return at;
}
