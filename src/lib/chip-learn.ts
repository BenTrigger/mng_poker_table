"use client";
import { useEffect, useState } from "react";
import { supabase } from "./supabase/client";
import { blobToBase64 } from "./image";
import type { Chip, LearnedChipType } from "./types";

export const REF_BUCKET = "chip-refs";
export const MAX_LEARN_PHOTOS = 5;
export const MAX_IMAGES_PER_CHIP = 4;

export type Box = [number, number, number, number];

/** Sends the photos to /api/learn-chips and returns the chip types found in them. */
export async function learnChipsFromPhotos(tableId: string, photos: Blob[]): Promise<{ types: LearnedChipType[]; notes: string }> {
  const payload = await Promise.all(
    photos.map(async (p) => {
      const bmp = await createImageBitmap(p);
      const out = { image: await blobToBase64(p), mediaType: "image/jpeg", width: bmp.width, height: bmp.height };
      bmp.close();
      return out;
    }),
  );
  const res = await fetch("/api/learn-chips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tableId, photos: payload }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `שגיאה ${res.status}`);
  }
  return res.json();
}

/** Crops a box out of a photo (with a little margin) into a small JPEG. */
export async function cropChip(photo: Blob, box: Box, max = 320): Promise<Blob> {
  const bmp = await createImageBitmap(photo);
  const [x0, y0, x1, y1] = box;
  const padX = (x1 - x0) * 0.08;
  const padY = (y1 - y0) * 0.08;
  const sx = Math.max(0, x0 - padX);
  const sy = Math.max(0, y0 - padY);
  const sw = Math.min(bmp.width, x1 + padX) - sx;
  const sh = Math.min(bmp.height, y1 + padY) - sy;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  canvas.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.88));
}

/** Uploads new reference crops for a table and returns their storage paths. */
export async function uploadChipImages(tableId: string, blobs: Blob[]): Promise<string[]> {
  const paths: string[] = [];
  for (const b of blobs) {
    const path = `${tableId}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase().storage.from(REF_BUCKET).upload(path, b, { contentType: "image/jpeg" });
    if (error) throw new Error(error.message);
    paths.push(path);
  }
  return paths;
}

/** Best effort: removes reference photos that are no longer used by the set. */
export async function removeChipImages(paths: string[]) {
  if (paths.length) await supabase().storage.from(REF_BUCKET).remove(paths);
}

/** Signed URLs for stored reference photos (the bucket is private). */
export function useChipImageUrls(chips: Pick<Chip, "images">[] | undefined): Record<string, string> {
  const key = (chips ?? []).flatMap((c) => c.images ?? []).join("|");
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const paths = key ? key.split("|") : [];
    if (!paths.length) return;
    let alive = true;
    supabase()
      .storage.from(REF_BUCKET)
      .createSignedUrls(paths, 60 * 60)
      .then(({ data }) => {
        if (!alive || !data) return;
        const m: Record<string, string> = {};
        data.forEach((d) => {
          if (d.path && d.signedUrl) m[d.path] = d.signedUrl;
        });
        setUrls(m);
      });
    return () => {
      alive = false;
    };
  }, [key]);
  return urls;
}

export { mergeLearned } from "./chip-merge";

/** Average colour of the middle of a crop, as #rrggbb (for chips marked by hand). */
export async function sampleColor(crop: Blob): Promise<string> {
  const bmp = await createImageBitmap(crop);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 8;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, bmp.width * 0.3, bmp.height * 0.3, bmp.width * 0.4, bmp.height * 0.4, 0, 0, 8, 8);
  bmp.close();
  const d = ctx.getImageData(0, 0, 8, 8).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return "#" + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("");
}
