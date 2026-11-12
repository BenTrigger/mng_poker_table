"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Chip } from "@/lib/types";
import { DEFAULT_CHIPS } from "@/lib/chips";
import { Button, ChipDot, Field, inputCls } from "./ui";

export function ChipSetEditor({ initial, initialName, onSave, saving }: { initial?: Chip[]; initialName?: string; onSave: (name: string, chips: Chip[]) => void; saving?: boolean }) {
  const [name, setName] = useState(initialName ?? "הערכה שלנו");
  const [chips, setChips] = useState<Chip[]>(initial ?? DEFAULT_CHIPS);
  const valid = name.trim() && chips.length > 0 && chips.every((c) => c.color.trim() && c.value > 0) && new Set(chips.map((c) => c.color.trim())).size === chips.length;

  function upd(i: number, patch: Partial<Chip>) {
    setChips((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  return (
    <div className="space-y-4">
      <Field label="שם הערכה">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="space-y-2">
        <div className="grid grid-cols-[44px_1fr_96px_36px] gap-2 px-1 text-xs text-muted">
          <span>צבע</span>
          <span>שם</span>
          <span>ערך בצ'יפים</span>
          <span />
        </div>
        {chips.map((c, i) => (
          <div key={i} className="grid grid-cols-[44px_1fr_96px_36px] items-center gap-2">
            <label className="relative grid size-11 cursor-pointer place-items-center rounded-2xl border border-line bg-surface-2">
              <ChipDot hex={c.hex} size={26} />
              <input type="color" value={c.hex} onChange={(e) => upd(i, { hex: e.target.value })} className="absolute inset-0 opacity-0" />
            </label>
            <input className={`${inputCls} h-11`} value={c.color} onChange={(e) => upd(i, { color: e.target.value })} />
            <input className={`${inputCls} h-11 text-center`} inputMode="decimal" value={c.value || ""} onChange={(e) => upd(i, { value: Number(e.target.value) || 0 })} />
            <button className="grid size-9 place-items-center rounded-xl text-muted hover:bg-white/5" onClick={() => setChips((cs) => cs.filter((_, j) => j !== i))} aria-label="מחק צבע">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setChips((cs) => [...cs, { color: "", hex: "#2b6cb0", value: 0 }])}>
          <Plus className="size-4" /> צבע נוסף
        </Button>
      </div>
      <p className="text-xs text-muted">הערכים הם ביחידות צ'יפ. את המחיר בכסף מגדירים בפתיחת ערב. שמות הצבעים משמשים לספירה מתמונה, אז תן שמות ברורים.</p>
      <Button className="w-full" disabled={!valid} loading={saving} onClick={() => onSave(name.trim(), chips.map((c) => ({ ...c, color: c.color.trim() })))}>
        שמירת ערכה
      </Button>
    </div>
  );
}
