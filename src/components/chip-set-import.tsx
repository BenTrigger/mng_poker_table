"use client";
import { useEffect, useState } from "react";
import { Download, Images } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { REF_BUCKET } from "@/lib/chip-learn";
import type { ChipSet } from "@/lib/types";
import { Button, Card, ChipDot, Sheet } from "./ui";

type Source = ChipSet & { table_name: string };

/** Chip sets on the other tables where the signed-in user is the admin (whoever built a set can reuse it). */
function useImportSources(tableId: string, enabled: boolean) {
  const [rows, setRows] = useState<Source[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      const sb = supabase();
      const { data: u } = await sb.auth.getUser();
      const { data: mine } = await sb
        .from("table_members")
        .select("table_id, poker_tables(name)")
        .eq("user_id", u.user?.id ?? "")
        .eq("role", "admin")
        .eq("status", "active")
        .neq("table_id", tableId);
      const tables = ((mine as { table_id: string; poker_tables: { name: string } | null }[] | null) ?? []);
      if (!tables.length) return setRows([]);
      const { data: sets } = await sb.from("chip_sets").select("*").in("table_id", tables.map((x) => x.table_id)).order("created_at");
      setRows(((sets as ChipSet[] | null) ?? []).map((s) => ({ ...s, table_name: tables.find((x) => x.table_id === s.table_id)?.poker_tables?.name ?? "" })));
    })();
  }, [tableId, enabled]);
  return rows;
}

/** Copies one reference photo into the new table's folder (copy, or download and upload). */
async function copyImage(from: string, tableId: string): Promise<string | null> {
  const store = supabase().storage.from(REF_BUCKET);
  const to = `${tableId}/${crypto.randomUUID()}.jpg`;
  const { error } = await store.copy(from, to);
  if (!error) return to;
  const { data: blob } = await store.download(from);
  if (!blob) return null;
  const up = await store.upload(to, blob, { contentType: "image/jpeg" });
  return up.error ? null : to;
}

/** Copies a chip set to another table: colours and values, learned photos and descriptions, and the latest count corrections. */
export async function importChipSet(src: ChipSet, tableId: string): Promise<ChipSet> {
  const sb = supabase();
  const chips = await Promise.all(
    src.chips.map(async (c) => {
      const images = c.images?.length ? (await Promise.all(c.images.map((p) => copyImage(p, tableId)))).filter((p): p is string => !!p) : undefined;
      return { ...c, images: images?.length ? images : undefined };
    }),
  );
  const { data, error } = await sb.from("chip_sets").insert({ table_id: tableId, name: src.name, chips }).select().single();
  if (error || !data) throw new Error(error?.message ?? "שגיאה בהעתקת הערכה");
  // what was learned from corrections on the original set (the counting prompt reads the latest ones)
  const { data: fixes } = await sb
    .from("chip_corrections")
    .select("detected, actual, note, created_at")
    .eq("chip_set_id", src.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (fixes?.length) {
    await sb.from("chip_corrections").insert(fixes.reverse().map((f) => ({ ...f, chip_set_id: data.id, table_id: tableId })));
  }
  return data as ChipSet;
}

/** Button + sheet: pick a set from another of my tables and copy it here. */
export function ChipSetImport({ tableId, onImported, className }: { tableId: string; onImported: (set: ChipSet) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const rows = useImportSources(tableId, open);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function pick(s: Source) {
    setBusy(s.id);
    setErr("");
    try {
      const set = await importChipSet(s, tableId);
      setOpen(false);
      onImported(set);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className={className} onClick={() => setOpen(true)}>
        <Download className="size-4" /> ערכה משולחן אחר שלי
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="ערכה משולחן אחר">
        <div className="space-y-3">
          <p className="text-sm text-muted">ערכות מהשולחנות שאתה מנהל. מעתיקים את הצבעים והערכים, וגם את מה שהאפליקציה למדה מהתמונות, לשולחן הזה.</p>
          {rows === null ? (
            <p className="py-6 text-center text-sm text-muted">טוען…</p>
          ) : rows.length === 0 ? (
            <Card className="text-center text-sm text-muted">אין לך ערכות בשולחנות אחרים שאתה מנהל.</Card>
          ) : (
            rows.map((s) => {
              const photos = s.chips.reduce((n, c) => n + (c.images?.length ?? 0), 0);
              return (
                <Card key={s.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{s.name}</div>
                    <div className="truncate text-xs text-muted">משולחן {s.table_name}</div>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {s.chips.map((c) => (
                        <span key={c.color} className="num inline-flex items-center gap-1 text-xs text-muted">
                          <ChipDot hex={c.hex} size={14} /> {c.value}
                        </span>
                      ))}
                      {photos > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-gold">
                          <Images className="size-3.5" /> נלמדה מתמונות
                        </span>
                      )}
                    </div>
                  </div>
                  <Button size="sm" loading={busy === s.id} disabled={!!busy} onClick={() => pick(s)}>
                    העתקה
                  </Button>
                </Card>
              );
            })
          )}
          {err && <p className="text-sm text-loss">{err}</p>}
        </div>
      </Sheet>
    </>
  );
}
