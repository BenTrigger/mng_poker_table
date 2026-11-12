"use client";
import { useState } from "react";
import { Camera, Plus, Trash2 } from "lucide-react";
import type { Chip } from "@/lib/types";
import { DEFAULT_CHIPS } from "@/lib/chips";
import { MAX_IMAGES_PER_CHIP, mergeLearned, removeChipImages, uploadChipImages, useChipImageUrls } from "@/lib/chip-learn";
import { ChipLearner } from "./chip-learner";
import { ChipSetNotes } from "./chip-set-notes";
import { Button, ChipDot, Field, inputCls } from "./ui";

type EditChip = Chip & { newImages?: Blob[]; previews?: string[] };

export function ChipSetEditor({
  tableId, chipSetId, initial, initialName, onSave, saving,
}: {
  tableId: string;
  /** set when editing a saved set: shows what was learned from count fixes */
  chipSetId?: string;
  initial?: Chip[];
  initialName?: string;
  onSave: (name: string, chips: Chip[]) => void | Promise<void>;
  saving?: boolean;
}) {
  const [name, setName] = useState(initialName ?? "הערכה שלנו");
  const [chips, setChips] = useState<EditChip[]>(initial ?? DEFAULT_CHIPS);
  const [touched, setTouched] = useState(false);
  const [learning, setLearning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const urls = useChipImageUrls(chips);
  const valid = name.trim() && chips.length > 0 && chips.every((c) => c.color.trim() && c.value > 0) && new Set(chips.map((c) => c.color.trim())).size === chips.length;

  function upd(i: number, patch: Partial<EditChip>) {
    setTouched(true);
    setChips((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  async function save() {
    setErr(null);
    setUploading(true);
    try {
      const out: Chip[] = [];
      const kept = new Set<string>();
      for (const c of chips) {
        const fresh = await uploadChipImages(tableId, (c.newImages ?? []).slice(0, MAX_IMAGES_PER_CHIP));
        const images = [...fresh, ...(c.images ?? [])].slice(0, MAX_IMAGES_PER_CHIP);
        images.forEach((p) => kept.add(p));
        out.push({ color: c.color.trim(), hex: c.hex, value: c.value, ...(images.length ? { images } : {}), ...(c.desc ? { desc: c.desc } : {}) });
      }
      await onSave(name.trim(), out);
      // photos the set no longer uses
      const old = (initial ?? []).flatMap((c) => c.images ?? []).filter((p) => !kept.has(p));
      removeChipImages(old).catch(() => {});
    } catch (e) {
      setErr(`השמירה נכשלה: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  if (learning) {
    return (
      <ChipLearner
        tableId={tableId}
        onCancel={() => setLearning(false)}
        onDone={(learned) => {
          setChips((cs) => {
            const merged = mergeLearned(cs, learned, !initial && !touched);
            return merged.map((c) => ({ ...c, previews: (c.newImages ?? []).map((b) => URL.createObjectURL(b)) }));
          });
          setTouched(true);
          setLearning(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Field label="שם הערכה">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <button onClick={() => setLearning(true)} className="flex w-full items-center gap-3 rounded-2xl border border-gold/40 bg-gold/5 p-3 text-start">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gold/15 text-gold"><Camera className="size-5" /></span>
        <span>
          <span className="block text-sm font-bold text-gold">למד את הערכה מתמונות</span>
          <span className="block text-xs text-muted">מצלמים את הצ&apos;יפים, והאפליקציה חותכת תמונה של כל סוג ומזהה את הערך. ככה הספירה מתמונה מדויקת יותר.</span>
        </span>
      </button>

      <div className="space-y-2">
        <div className="grid grid-cols-[44px_1fr_96px_36px] gap-2 px-1 text-xs text-muted">
          <span>צ&apos;יפ</span>
          <span>שם</span>
          <span>ערך בצ&apos;יפים</span>
          <span />
        </div>
        {chips.map((c, i) => {
          const thumb = c.previews?.[0] ?? (c.images?.[0] ? urls[c.images[0]] : undefined);
          const photoCount = (c.newImages?.length ?? 0) + (c.images?.length ?? 0);
          return (
            <div key={i} className="grid grid-cols-[44px_1fr_96px_36px] items-center gap-2">
              <label className="relative grid size-11 cursor-pointer place-items-center overflow-hidden rounded-2xl border border-line bg-surface-2" title={photoCount ? `${photoCount} תמונות` : undefined}>
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt={c.color} className="size-full object-cover" />
                ) : (
                  <ChipDot hex={c.hex} size={26} />
                )}
                <input type="color" value={c.hex} onChange={(e) => upd(i, { hex: e.target.value })} className="absolute inset-0 opacity-0" aria-label="צבע" />
              </label>
              <input className={`${inputCls} h-11`} value={c.color} onChange={(e) => upd(i, { color: e.target.value })} />
              <input className={`${inputCls} h-11 text-center`} inputMode="decimal" value={c.value || ""} onChange={(e) => upd(i, { value: Number(e.target.value) || 0 })} />
              <button className="grid size-9 place-items-center rounded-xl text-muted hover:bg-white/5" onClick={() => { setTouched(true); setChips((cs) => cs.filter((_, j) => j !== i)); }} aria-label="מחק צבע">
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
        <Button variant="ghost" size="sm" onClick={() => { setTouched(true); setChips((cs) => [...cs, { color: "", hex: "#2b6cb0", value: 0 }]); }}>
          <Plus className="size-4" /> צבע נוסף
        </Button>
      </div>
      <p className="text-xs text-muted">הערכים הם ביחידות צ&apos;יפ. את המחיר בכסף מגדירים בפתיחת ערב. השמות והתמונות משמשים לספירה מתמונה.</p>
      {err && <p className="text-sm text-loss">{err}</p>}
      <Button className="w-full" disabled={!valid} loading={saving || uploading} onClick={save}>
        שמירת ערכה
      </Button>
      {chipSetId && (
        <div className="border-t border-line pt-4">
          <ChipSetNotes chipSetId={chipSetId} tableId={tableId} />
        </div>
      )}
    </div>
  );
}
