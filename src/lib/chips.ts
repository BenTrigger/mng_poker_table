import type { Chip, ChipCount, ChipSet } from "./types";
import { blobToBase64 } from "./image";
import { supabase } from "./supabase/client";

export const DEFAULT_CHIPS: Chip[] = [
  { color: "לבן", hex: "#f1f1f1", value: 1 },
  { color: "אדום", hex: "#d7263d", value: 5 },
  { color: "ירוק", hex: "#1b998b", value: 25 },
  { color: "שחור", hex: "#1c1c1c", value: 100 },
  { color: "סגול", hex: "#7b2cbf", value: 500 },
];

export async function countChipsFromPhoto(photo: Blob, chipSet: Pick<ChipSet, "id" | "chips" | "table_id">, expected?: number): Promise<ChipCount> {
  const res = await fetch("/api/count-chips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: await blobToBase64(photo), mediaType: "image/jpeg", chips: chipSet.chips, expected, tableId: chipSet.table_id, chipSetId: chipSet.id }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `שגיאה ${res.status}`);
  }
  return res.json();
}

let enabledCache: boolean | null = null;
export async function chipCountingEnabled(): Promise<boolean> {
  if (enabledCache != null) return enabledCache;
  try {
    const r = await fetch("/api/count-chips");
    enabledCache = (await r.json()).enabled === true;
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

/** Suggest which chips the cashier should hand over (largest first, keeps some small change). */
export function breakdown(total: number, chips: Chip[]): { chip: Chip; count: number }[] {
  const sorted = [...chips].filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
  const out: { chip: Chip; count: number }[] = [];
  let left = total;
  sorted.forEach((c, i) => {
    // keep ~20% of the stack in smaller denominations when possible
    const isSmallest = i === sorted.length - 1;
    const budget = isSmallest ? left : Math.floor((left * (i === 0 ? 0.6 : 0.8)) / c.value) * c.value;
    const n = Math.floor(budget / c.value);
    if (n > 0) {
      out.push({ chip: c, count: n });
      left -= n * c.value;
    }
  });
  if (left > 0 && out.length) {
    // fix rounding with the smallest chip
    const smallest = sorted[sorted.length - 1];
    const extra = Math.round(left / smallest.value);
    const row = out.find((r) => r.chip.color === smallest.color);
    if (row) row.count += extra;
    else if (extra > 0) out.push({ chip: smallest, count: extra });
  }
  return out;
}

/** Remembers a fix to an automatic count (and/or a note) so later counts of this set learn from it. */
export async function saveChipCorrection(
  chipSet: Pick<ChipSet, "id" | "table_id">,
  fix: { detected?: { color: string; count: number }[]; actual?: { color: string; count: number }[]; note?: string },
) {
  const note = fix.note?.trim() || null;
  const changed = fix.detected && fix.actual && fix.detected.some((d) => fix.actual!.find((a) => a.color === d.color)?.count !== d.count);
  if (!note && !changed) return;
  const { data: auth } = await supabase().auth.getUser();
  await supabase().from("chip_corrections").insert({
    chip_set_id: chipSet.id,
    table_id: chipSet.table_id,
    detected: changed ? fix.detected : null,
    actual: changed ? fix.actual : null,
    note,
    created_by: auth.user?.id,
  });
}
