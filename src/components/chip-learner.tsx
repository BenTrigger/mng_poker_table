"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, Crop, ImagePlus, Plus, Sparkles, Trash2, X } from "lucide-react";
import { compressImage } from "@/lib/image";
import { chipCountingEnabled } from "@/lib/chips";
import { type Box, MAX_LEARN_PHOTOS, cropChip, learnChipsFromPhotos, sampleColor } from "@/lib/chip-learn";
import type { Chip } from "@/lib/types";
import { Badge, Button, Card, inputCls } from "./ui";

type Photo = { blob: Blob; url: string; w: number; h: number };
type CropItem = { photo: number; view: "top" | "side"; box: Box; blob: Blob; url: string };
type ReviewType = {
  key: string;
  name: string;
  hex: string;
  value: string;
  printed: boolean;
  suggested: number | null;
  desc: string;
  crops: CropItem[];
};
export type LearnedChip = Chip & { newImages: Blob[] };

let keySeq = 0;
const newKey = () => `t${++keySeq}`;

/**
 * Learns a chip set from real photos: the user photographs the chips (several in a
 * photo, several photos, also from the side), the app finds each chip type, crops a
 * real picture of it and reads its value when printed. Everything is editable, and
 * chips the recogniser missed can be marked by hand.
 */
export function ChipLearner({ tableId, onDone, onCancel }: { tableId: string; onDone: (chips: LearnedChip[]) => void; onCancel: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [phase, setPhase] = useState<"photos" | "working" | "review">("photos");
  const [types, setTypes] = useState<ReviewType[]>([]);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<{ type: number; crop: number } | { type: -1; crop: -1 } | null>(null);

  useEffect(() => {
    chipCountingEnabled().then(setAiOn);
  }, []);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = MAX_LEARN_PHOTOS - photos.length;
    const added: Photo[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      const blob = await compressImage(f, 1400);
      const bmp = await createImageBitmap(blob);
      added.push({ blob, url: URL.createObjectURL(blob), w: bmp.width, h: bmp.height });
      bmp.close();
    }
    setPhotos((p) => [...p, ...added]);
  }

  async function recognise() {
    setErr(null);
    if (!aiOn) {
      setPhase("review");
      return;
    }
    setPhase("working");
    try {
      const r = await learnChipsFromPhotos(tableId, photos.map((p) => p.blob));
      const reviewed: ReviewType[] = [];
      for (const t of r.types) {
        const crops: CropItem[] = [];
        for (const c of t.crops) {
          const blob = await cropChip(photos[c.photo].blob, c.box);
          crops.push({ ...c, blob, url: URL.createObjectURL(blob) });
        }
        reviewed.push({
          key: newKey(),
          name: t.name,
          hex: t.hex,
          value: t.value ? String(t.value) : "",
          printed: t.value != null,
          suggested: t.value == null ? t.suggested : null,
          desc: t.desc,
          crops,
        });
      }
      setTypes(reviewed);
      setNotes(r.notes);
      setPhase("review");
    } catch (e) {
      setErr(`הזיהוי נכשל: ${(e as Error).message}. אפשר לנסות שוב או לסמן ידנית.`);
      setPhase("review");
    }
  }

  function upd(i: number, patch: Partial<ReviewType>) {
    setTypes((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  async function applyAdjust(photo: number, box: Box, view: "top" | "side") {
    if (!adjust) return;
    const blob = await cropChip(photos[photo].blob, box);
    const item: CropItem = { photo, view, box, blob, url: URL.createObjectURL(blob) };
    if (adjust.type === -1) {
      const hex = await sampleColor(blob);
      setTypes((ts) => [...ts, { key: newKey(), name: "", hex, value: "", printed: false, suggested: null, desc: "", crops: [item] }]);
    } else {
      const { type, crop } = adjust;
      setTypes((ts) =>
        ts.map((t, j) => (j !== type ? t : { ...t, crops: crop < t.crops.length ? t.crops.map((c, k) => (k === crop ? item : c)) : [...t.crops, item] })),
      );
    }
    setAdjust(null);
  }

  const names = types.map((t) => t.name.trim());
  const valid =
    types.length > 0 &&
    types.every((t) => t.name.trim() && Number(t.value) > 0 && t.crops.length > 0) &&
    new Set(names).size === names.length;

  function finish() {
    onDone(
      types.map((t) => ({
        color: t.name.trim(),
        hex: t.hex,
        value: Number(t.value),
        desc: t.desc || undefined,
        // face views first: they are the clearest reference
        newImages: [...t.crops].sort((a, b) => (a.view === b.view ? 0 : a.view === "top" ? -1 : 1)).map((c) => c.blob),
      })),
    );
  }

  const input = (
    <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
  );

  if (adjust) {
    const start = adjust.type >= 0 ? types[adjust.type].crops[adjust.crop] : undefined;
    return <CropPicker photos={photos} initial={start} onCancel={() => setAdjust(null)} onSave={applyAdjust} />;
  }

  if (phase === "photos" || phase === "working") {
    return (
      <div className="space-y-4">
        {input}
        <Card className="space-y-2 p-3 text-sm">
          <div className="flex items-center gap-2 font-bold text-gold"><Camera className="size-4" /> איך מצלמים</div>
          <div className="grid grid-cols-2 gap-2 text-center text-[11px] text-muted">
            <div className="rounded-xl bg-surface-2 p-2">
              <svg viewBox="0 0 100 44" className="mx-auto h-12 w-full" aria-hidden>
                <rect width="100" height="44" rx="4" fill="#1f5135" />
                {["#e0158a", "#1f1f22", "#e8ec3a", "#2b2f9a", "#ece8ea"].map((c, i) => (
                  <g key={c}>
                    <circle cx={12 + i * 19} cy="22" r="8" fill={c} stroke="#fff" strokeWidth="1.2" strokeDasharray="2 2" />
                    <circle cx={12 + i * 19} cy="22" r="4" fill="#fff" />
                  </g>
                ))}
              </svg>
              <div className="mt-1 font-bold text-ink">תמונה 1: מלמעלה</div>
              צ&apos;יפ אחד מכל סוג, בשורה, הפנים למעלה
            </div>
            <div className="rounded-xl bg-surface-2 p-2">
              <svg viewBox="0 0 100 44" className="mx-auto h-12 w-full" aria-hidden>
                <rect y="38" width="100" height="6" rx="2" fill="#1f5135" />
                {["#e0158a", "#1f1f22", "#e8ec3a", "#2b2f9a", "#ece8ea"].map((c, i) =>
                  Array.from({ length: 5 }, (_, k) => (
                    <rect key={`${c}-${k}`} x={3 + i * 19.5} y={33 - k * 5} width="15" height="4.3" rx="1" fill={c} stroke="#fff" strokeWidth="0.5" strokeDasharray="2 2.5" />
                  )),
                )}
              </svg>
              <div className="mt-1 font-bold text-ink">תמונה 2: מהצד</div>
              ערימה של 5 מכל סוג, בגובה השולחן
            </div>
          </div>
          <ul className="list-disc space-y-1 ps-5 text-muted">
            <li>שתי התמונות האלה הן התבנית. אפשר להוסיף עוד מזוויות אחרות.</li>
            <li>אור טוב, בלי פלאש ישיר, רקע אחיד. עד {MAX_LEARN_PHOTOS} תמונות.</li>
          </ul>
        </Card>

        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <div key={p.url} className="relative aspect-square overflow-hidden rounded-2xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`תמונה ${i + 1}`} className="size-full object-cover" />
              {phase === "photos" && (
                <button className="glass absolute top-1 left-1 grid size-7 place-items-center rounded-full" aria-label="הסר תמונה" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </button>
              )}
            </div>
          ))}
          {photos.length < MAX_LEARN_PHOTOS && phase === "photos" && (
            <button onClick={() => fileRef.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-gold/40 bg-gold/5 text-gold">
              <ImagePlus className="size-7" />
              <span className="text-xs font-bold">{photos.length ? "עוד תמונה" : "צילום / גלריה"}</span>
            </button>
          )}
        </div>

        {aiOn === false && <p className="text-xs text-warn">הזיהוי האוטומטי עוד לא מופעל באתר. אפשר להמשיך ולסמן כל צ'יפ בתמונה בעצמך.</p>}
        {phase === "working" ? (
          <div className="flex items-center justify-center gap-2 py-3 text-sm text-gold"><Sparkles className="size-4 animate-pulse" /> מזהה את סוגי הצ'יפים... (עד דקה)</div>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>ביטול</Button>
            <Button className="flex-1" disabled={!photos.length || aiOn == null} onClick={recognise}>
              {aiOn ? <><Sparkles className="size-4" /> זהה צ'יפים</> : "המשך לסימון"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {input}
      {err && <p className="text-xs text-warn">{err}</p>}
      {types.length > 0 ? (
        <p className="text-sm text-muted">מצאתי {types.length} סוגי צ'יפים. בדוק שם וערך לכל אחד, ותקן מה שצריך.</p>
      ) : (
        <p className="text-sm text-muted">סמן כל סוג צ'יפ בתמונות: לחץ &quot;סמן צ'יפ&quot;, בחר תמונה ולחץ על הצ'יפ.</p>
      )}
      {notes && <p className="rounded-xl bg-warn/10 p-2 text-xs text-warn">{notes}</p>}

      {types.map((t, i) => {
        const missing = !(Number(t.value) > 0);
        return (
          <Card key={t.key} className={`space-y-2 p-3 ${missing ? "border-gold/60" : ""}`}>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {t.crops.map((c, k) => (
                <div key={c.url} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.url} alt={t.name} className="size-20 rounded-xl border border-line object-cover" />
                  <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px]">{c.view === "top" ? "מלמעלה" : "מהצד"}</span>
                  <button className="glass absolute top-1 left-1 grid size-6 place-items-center rounded-full" aria-label="תקן חיתוך" onClick={() => setAdjust({ type: i, crop: k })}>
                    <Crop className="size-3.5" />
                  </button>
                  {t.crops.length > 1 && (
                    <button className="glass absolute top-1 right-1 grid size-6 place-items-center rounded-full" aria-label="הסר תמונה" onClick={() => upd(i, { crops: t.crops.filter((_, j) => j !== k) })}>
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button className="grid size-20 shrink-0 place-items-center rounded-xl border border-dashed border-line text-muted" aria-label="הוסף תמונה לצ'יפ" onClick={() => setAdjust({ type: i, crop: t.crops.length })}>
                <Plus className="size-5" />
              </button>
            </div>
            <div className="grid grid-cols-[44px_1fr_96px_36px] items-center gap-2">
              <label className="relative grid size-11 cursor-pointer place-items-center rounded-2xl border border-line" style={{ background: t.hex }}>
                <input type="color" value={t.hex} onChange={(e) => upd(i, { hex: e.target.value })} className="absolute inset-0 opacity-0" aria-label="צבע" />
              </label>
              <input className={`${inputCls} h-11`} placeholder="שם (למשל אדום)" value={t.name} onChange={(e) => upd(i, { name: e.target.value })} />
              <input
                className={`${inputCls} h-11 text-center ${missing ? "border-gold" : ""}`}
                inputMode="decimal"
                placeholder="ערך?"
                value={t.value}
                onChange={(e) => upd(i, { value: e.target.value.replace(/[^\d.]/g, ""), printed: false })}
              />
              <button className="grid size-9 place-items-center rounded-xl text-muted hover:bg-white/5" aria-label="מחק סוג" onClick={() => setTypes((ts) => ts.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {t.printed && <Badge tone="win"><Check className="size-3" /> הערך זוהה מהצ'יפ</Badge>}
              {missing && <span className="font-bold text-gold">מה הערך של הצ'יפ הזה?</span>}
              {missing && t.suggested && (
                <button className="rounded-full bg-gold/15 px-2.5 py-1 font-bold text-gold" onClick={() => upd(i, { value: String(t.suggested) })}>
                  אולי {t.suggested}?
                </button>
              )}
            </div>
          </Card>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <Button variant="soft" size="sm" onClick={() => setAdjust({ type: -1, crop: -1 })}>
          <Plus className="size-4" /> סמן צ'יפ שפוספס
        </Button>
        {photos.length < MAX_LEARN_PHOTOS && (
          <Button variant="ghost" size="sm" onClick={() => setPhase("photos")}>
            <ImagePlus className="size-4" /> עוד תמונות וזיהוי מחדש
          </Button>
        )}
      </div>
      {types.length > 0 && new Set(names).size !== names.length && <p className="text-xs text-loss">לכל סוג צריך שם אחר.</p>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>ביטול</Button>
        <Button className="flex-1" disabled={!valid} onClick={finish}>
          <Check className="size-4" /> אישור הצ'יפים
        </Button>
      </div>
    </div>
  );
}

/** Pick a chip in one of the photos: tap its centre, set the size. */
function CropPicker({
  photos, initial, onSave, onCancel,
}: {
  photos: Photo[];
  initial?: { photo: number; view: "top" | "side"; box: Box };
  onSave: (photo: number, box: Box, view: "top" | "side") => void;
  onCancel: () => void;
}) {
  const [photo, setPhoto] = useState(initial?.photo ?? 0);
  const p = photos[photo];
  const init = initial && initial.photo === photo ? initial.box : null;
  const [center, setCenter] = useState<[number, number]>(init ? [(init[0] + init[2]) / 2, (init[1] + init[3]) / 2] : [p.w / 2, p.h / 2]);
  const [size, setSize] = useState<[number, number]>(init ? [init[2] - init[0], init[3] - init[1]] : [p.w / 5, p.w / 5]);
  const [view, setView] = useState<"top" | "side">(initial?.view ?? "top");

  function pickPhoto(i: number) {
    setPhoto(i);
    const q = photos[i];
    setCenter([q.w / 2, q.h / 2]);
    setSize([q.w / 5, q.w / 5]);
  }

  const box: Box = [
    Math.max(0, center[0] - size[0] / 2), Math.max(0, center[1] - size[1] / 2),
    Math.min(p.w, center[0] + size[0] / 2), Math.min(p.h, center[1] + size[1] / 2),
  ];
  const scale = size[0] / p.w;

  return (
    <div className="space-y-3">
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((q, i) => (
            <button key={q.url} onClick={() => pickPhoto(i)} className={`shrink-0 overflow-hidden rounded-xl border-2 ${i === photo ? "border-gold" : "border-transparent"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.url} alt={`תמונה ${i + 1}`} className="size-14 object-cover" />
            </button>
          ))}
        </div>
      )}
      <p className="text-sm text-muted">לחץ על מרכז הצ'יפ, וכוון את הגודל כך שהמסגרת תתפוס צ'יפ אחד.</p>
      <div
        className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-2xl border border-line"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setCenter([((e.clientX - r.left) / r.width) * p.w, ((e.clientY - r.top) / r.height) * p.h]);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.url} alt="" className="block w-full select-none" draggable={false} />
        <div
          className="pointer-events-none absolute rounded-lg border-2 border-gold shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{ left: `${(box[0] / p.w) * 100}%`, top: `${(box[1] / p.h) * 100}%`, width: `${((box[2] - box[0]) / p.w) * 100}%`, height: `${((box[3] - box[1]) / p.h) * 100}%` }}
        />
      </div>
      <label className="block text-xs text-muted">
        גודל
        <input type="range" min={0.03} max={0.9} step={0.01} value={scale} className="w-full accent-[var(--color-gold)]"
          onChange={(e) => { const s = Number(e.target.value) * p.w; setSize(([w, h]) => [s, (h / w) * s]); }} />
      </label>
      <label className="block text-xs text-muted">
        גובה (לצילום מהצד, מסגרת שטוחה)
        <input type="range" min={0.2} max={1.5} step={0.05} value={size[1] / size[0]} className="w-full accent-[var(--color-gold)]"
          onChange={(e) => setSize(([w]) => [w, w * Number(e.target.value)])} />
      </label>
      <div className="flex gap-2 text-xs">
        {(["top", "side"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`rounded-xl px-3 py-1.5 font-bold ${view === v ? "bg-gold text-[#1d1405]" : "bg-surface-2 text-muted"}`}>
            {v === "top" ? "צולם מלמעלה" : "צולם מהצד"}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>ביטול</Button>
        <Button className="flex-1" onClick={() => onSave(photo, box, view)}><Check className="size-4" /> שמירת חיתוך</Button>
      </div>
    </div>
  );
}
