"use client";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import type { ChipCorrection } from "@/lib/types";
import { Button, inputCls } from "./ui";

/** What the app has learned about a chip set from people's fixes, plus free notes. Used by later photo counts. */
export function ChipSetNotes({ chipSetId, tableId }: { chipSetId: string; tableId: string }) {
  const [rows, setRows] = useState<ChipCorrection[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase()
      .from("chip_corrections")
      .select("*")
      .eq("chip_set_id", chipSetId)
      .order("created_at", { ascending: false })
      .limit(30);
    setRows((data as ChipCorrection[]) ?? []);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipSetId]);

  async function add() {
    setBusy(true);
    const { data: auth } = await supabase().auth.getUser();
    await supabase().from("chip_corrections").insert({ chip_set_id: chipSetId, table_id: tableId, note: note.trim(), created_by: auth.user?.id });
    setNote("");
    setBusy(false);
    load();
  }

  async function remove(id: string) {
    await supabase().from("chip_corrections").delete().eq("id", id);
    load();
  }

  function describe(r: ChipCorrection) {
    const diffs = (r.actual ?? [])
      .map((a) => ({ color: a.color, was: r.detected?.find((d) => d.color === a.color)?.count ?? 0, is: a.count }))
      .filter((d) => d.was !== d.is)
      .map((d) => `${d.color}: זוהו ${d.was}, היו ${d.is}`);
    return diffs.join(" · ");
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-bold">מה למדנו על הערכה</div>
      <p className="text-xs text-muted">תיקונים שנעשו בספירה מתמונה והערות. הזיהוי הבא של הערכה הזו לוקח אותם בחשבון (10 האחרונים).</p>
      <div className="flex gap-2">
        <input className={`${inputCls} h-11 text-sm`} placeholder="הערה, למשל: לשחור יש פס לבן דק בצד" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        <Button size="md" variant="soft" disabled={!note.trim()} loading={busy} onClick={add}>הוסף</Button>
      </div>
      {rows?.length === 0 && <p className="text-xs text-muted">עוד אין תיקונים.</p>}
      {rows?.map((r) => (
        <div key={r.id} className="flex items-start gap-2 rounded-xl bg-surface-2 p-2 text-xs">
          <div className="min-w-0 flex-1 space-y-0.5">
            {describe(r) && <div className="num">{describe(r)}</div>}
            {r.note && <div className="text-muted">{r.note}</div>}
            <div className="text-[10px] text-muted">{new Date(r.created_at).toLocaleDateString("he-IL")}</div>
          </div>
          <button className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-white/5" aria-label="מחק" onClick={() => remove(r.id)}>
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
