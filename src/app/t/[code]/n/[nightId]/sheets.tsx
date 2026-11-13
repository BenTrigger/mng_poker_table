"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, X, AlertTriangle, Pencil, Share2, Landmark, UserPlus, LogOut, ImageIcon, Sparkles, Trash2, ArrowLeftRight, HandCoins, Copy, Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { verdictOf } from "@/lib/verdict";
import { addGuest as addGuestByName } from "@/lib/guests";
import { logEvent } from "@/lib/hooks";
import { chipCheck, chipRate, chipSetTotal, chipsToMoney, foodCharges, formatMoney, formatSigned, moneyToChips, nightResult, playerLines, round2, type NightResult, type PlayerLine, type SettleMode } from "@/lib/calc";
import { breakdown, chipCountingEnabled, countChipsFromPhoto, saveChipCorrection } from "@/lib/chips";
import { compressImage } from "@/lib/image";
import type { PokerTable, CashierHandover, ChipCount, ChipRequest, ChipSet, GameNight, Member, NightEvent, NightPlayer, Settlement } from "@/lib/types";
import { Avatar, Badge, Button, Card, ChipDot, Field, Sheet, inputCls } from "@/components/ui";

export const nameOf = (members: Member[], id: string) => members.find((m) => m.id === id)?.display_name ?? "שחקן";

/** Readable message for errors the database raises on chip requests and cash-outs. */
export function nightError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes("player is not playing")) return "השחקן כבר לא משחק בערב (קם מהשולחן), אי אפשר לרשום לו צ'יפים.";
  if (msg.includes("night is closed")) return "הערב כבר נסגר.";
  if (msg.includes("only the cashier can record")) return "רק הקופאי או המנהל רושמים צ'יפים שנמסרו.";
  if (msg.includes("flagged chip request")) return "יש לשחקן מסירה שממתינה לאישור מנהל. קודם מחליטים עליה, ואז סוגרים לו חשבון.";
  return msg || "משהו השתבש, נסה שוב";
}

export async function myUid() {
  return (await supabase().auth.getUser()).data.user?.id ?? null;
}

export async function uploadPhoto(nightId: string, name: string, blob: Blob) {
  const path = `${nightId}/${name}-${Date.now()}.jpg`;
  const { error } = await supabase().storage.from("chip-photos").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

function useSignedUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    supabase().storage.from("chip-photos").createSignedUrl(path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [path]);
  return url;
}

export function PhotoThumb({ path }: { path: string | null }) {
  const url = useSignedUrl(path);
  if (!path) return null;
  return (
    <a href={url ?? "#"} target="_blank" rel="noreferrer" className="block size-12 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="צילום" className="size-full object-cover" /> : <ImageIcon className="m-3 size-6 text-muted" />}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Player asks the cashier for chips (by chips or by money)
// ---------------------------------------------------------------------------
export function RequestSheet({
  open, onClose, night, me, canManage, players, members, chipSet, initialFor,
}: {
  open: boolean; onClose: () => void; night: GameNight; me: Member; canManage: boolean; players: NightPlayer[]; members: Member[]; chipSet: ChipSet | null;
  /** admin/cashier tapped a player: the request is for them */
  initialFor?: string | null;
}) {
  const rate = chipRate(night);
  const playing = players.filter((p) => p.status === "playing");
  const [mode, setMode] = useState<"chips" | "money">("chips");
  const [value, setValue] = useState<number>(Number(night.chips_per_buyin));
  // who the request is for; the admin and the cashier can pick several players at once
  const [forIds, setForIds] = useState<string[]>([me.id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode("chips");
      setValue(Number(night.chips_per_buyin));
      const first =
        initialFor && playing.some((p) => p.member_id === initialFor)
          ? initialFor
          : playing.some((p) => p.member_id === me.id)
            ? me.id
            : playing[0]?.member_id ?? me.id;
      setForIds([first]);
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chips = mode === "chips" ? value : moneyToChips(value, rate);
  const money = mode === "chips" ? chipsToMoney(value, rate) : value;
  const quick = [0.5, 1, 2].map((k) => ({ k, chips: Math.round(Number(night.chips_per_buyin) * k) }));

  async function send() {
    setBusy(true);
    setErr(null);
    const uid = await myUid();
    const failed: string[] = [];
    let lastErr: string | null = null;
    for (const forId of forIds) {
      // the cashier/admin hands the chips themselves: recorded as handed in one step, no request to approve
      const direct = canManage
        ? { status: "approved" as const, given_chips: chips, approved_by: uid, approved_at: new Date().toISOString(), note: "נרשם ישירות בקופה" }
        : {};
      const { data, error } = await supabase()
        .from("chip_requests")
        .insert({ night_id: night.id, member_id: forId, requested_by: uid, mode, chips, ...direct })
        .select()
        .single();
      if (error) {
        failed.push(forId);
        lastErr = nightError(error);
        continue;
      }
      if (canManage) await logEvent(night.id, "approved", { member_id: forId, given: chips, request_id: data?.id, direct: true });
      else await logEvent(night.id, "request", { member_id: forId, chips, money, request_id: data?.id, on_behalf: forId !== me.id });
    }
    setBusy(false);
    if (failed.length) {
      // keep only the ones that did not go through, so a retry does not double the others
      setForIds(failed);
      return setErr(forIds.length > 1 ? `לא נשלח עבור ${failed.map((id) => nameOf(members, id)).join(", ")}: ${lastErr}` : lastErr);
    }
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={canManage ? "רישום צ'יפים" : "בקשת צ'יפים"}>
      <div className="space-y-4">
        {canManage && <p className="text-xs text-muted">אתה מוסר את הצ&apos;יפים: הם נרשמים מיד כנמסרו, בלי בקשה ואישור. בקשות ששחקנים שולחים בעצמם מגיעות לקופה כרגיל.</p>}
        {canManage && playing.length > 1 && (
          <Field label={forIds.length > 1 ? `עבור ${forIds.length} שחקנים (אותה כמות לכל אחד)` : "עבור (אפשר לסמן כמה)"}>
            <div className="flex flex-wrap gap-2">
              {playing.map((p) => {
                const on = forIds.includes(p.member_id);
                return (
                  <button
                    key={p.member_id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setForIds((ids) => (on ? (ids.length > 1 ? ids.filter((x) => x !== p.member_id) : ids) : [...ids, p.member_id]))}
                    className={`flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-bold ${on ? "bg-gold text-[#1d1405]" : "bg-surface-2 text-muted"}`}
                  >
                    {on && <Check className="size-3.5" />}
                    {nameOf(members, p.member_id)}
                    {p.member_id === me.id && " (אני)"}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        <div className="grid grid-cols-2 rounded-2xl bg-surface-2 p-1">
          {(["chips", "money"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setValue(m === "chips" ? chips : money);
              }}
              className={`h-10 rounded-xl text-sm font-bold ${mode === m ? "bg-gold text-[#1d1405]" : "text-muted"}`}
            >
              {m === "chips" ? "לפי צ'יפים" : "לפי סכום ₪"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {quick.map((q) => (
            <button
              key={q.k}
              onClick={() => {
                setMode("chips");
                setValue(q.chips);
              }}
              className={`rounded-2xl border p-2 text-center ${mode === "chips" && value === q.chips ? "border-gold bg-gold/10" : "border-line bg-surface-2"}`}
            >
              <div className="text-xs text-muted">{q.k === 1 ? "כניסה" : q.k === 0.5 ? "חצי כניסה" : "כניסה כפולה"}</div>
              <div className="num font-bold">{formatMoney(chipsToMoney(q.chips, rate))}</div>
            </button>
          ))}
        </div>
        <input
          className={`${inputCls} h-16 text-center text-3xl font-extrabold`}
          inputMode="decimal"
          value={value || ""}
          onChange={(e) => setValue(Number(e.target.value) || 0)}
        />
        <div className="text-center text-sm text-muted">
          <span className="num font-bold text-ink">{chips.toLocaleString()}</span> צ'יפים = <span className="num font-bold text-ink">{formatMoney(money)}</span>
        </div>
        {chipSet && chips > 0 && <Breakdown total={chips} chipSet={chipSet} />}
        {err && <p className="text-sm text-loss">{err}</p>}
        <Button size="lg" className="w-full" disabled={chips <= 0} loading={busy} onClick={send}>
          {canManage ? (forIds.length > 1 ? `רישום: נמסר ל-${forIds.length} שחקנים` : "רישום: נמסר") : "שליחה לקופאי"}
        </Button>
      </div>
    </Sheet>
  );
}

function Breakdown({ total, chipSet }: { total: number; chipSet: ChipSet }) {
  const b = breakdown(total, chipSet.chips);
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {b.map((r) => (
        <span key={r.chip.color} className="num inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-bold">
          <ChipDot hex={r.chip.hex} size={14} /> {r.count} × {r.chip.value}
        </span>
      ))}
    </div>
  );
}

/** How to photograph chips so the count is right: a small picture plus three rules. */
export function StackPhotoGuide() {
  return (
    <details className="rounded-2xl border border-line bg-surface-2/50 p-3 text-xs">
      <summary className="cursor-pointer font-bold text-gold">איך מצלמים כדי שהספירה תצא מדויקת</summary>
      <div className="mt-2 flex items-center gap-3">
        <svg viewBox="0 0 120 70" className="h-16 w-28 shrink-0" aria-hidden>
          <rect x="0" y="62" width="120" height="8" rx="2" fill="#1f5135" />
          {[
            { x: 6, n: 8, c: "#e0158a" },
            { x: 34, n: 10, c: "#1f1f22" },
            { x: 62, n: 6, c: "#e8ec3a" },
            { x: 90, n: 9, c: "#2b2f9a" },
          ].map((st) =>
            Array.from({ length: st.n }, (_, i) => (
              <rect key={`${st.x}-${i}`} x={st.x} y={58 - i * 5} width="24" height="4.2" rx="1.2" fill={st.c} stroke="#fff" strokeWidth="0.4" strokeDasharray="2 3" />
            )),
          )}
        </svg>
        <ul className="list-disc space-y-1 ps-4 text-muted">
          <li>ערימה לכל צבע, עד 20 צ&apos;יפים, בשורה עם רווח קטן.</li>
          <li>מהצד, בגובה השולחן, כל הערימות בתמונה ובפוקוס.</li>
          <li>אור על צד הערימות, בלי פלאש. ערימה גבוהה? לחלק לשתיים.</li>
        </ul>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Chip counter: photo -> AI count (if configured) with manual override
// ---------------------------------------------------------------------------
export function ChipCounter({
  chipSet, expected, onDone, cta, busy, hint = "צלם את הערימה מהצד", verdict = false, initial, rate = 0,
}: {
  chipSet: ChipSet | null; expected?: number; cta: string; busy?: boolean; hint?: string;
  /** a count being corrected starts from what was saved */
  initial?: number | null;
  /** money per chip: lets the count be typed as a cash amount (₪) instead of chips */
  rate?: number;
  /** hand-over to a player: say right away whether the photo matches what they asked for */
  verdict?: boolean;
  onDone: (r: { total: number; photo: Blob | null; detected: number | null; count: ChipCount | null; manual: boolean }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [counting, setCounting] = useState(false);
  const [count, setCount] = useState<ChipCount | null>(null);
  // a hand-over starts at what the player asked for: no photo needed, one tap to confirm
  const [manual, setManual] = useState<string>(verdict && expected ? String(expected) : initial != null ? String(initial) : "");
  const [unit, setUnit] = useState<"chips" | "money">("chips");
  const [byColour, setByColour] = useState(false);
  const [fixed, setFixed] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    chipCountingEnabled().then(setAiOn);
  }, []);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr(null);
    setCount(null);
    // tall stacks need detail: keep more pixels than other photos
    const blob = await compressImage(f, 2048, 0.88);
    setPhoto(blob);
    setPreview(URL.createObjectURL(blob));
    // the photo may come before the "is counting on?" answer did: wait for it
    if ((aiOn || (await chipCountingEnabled())) && chipSet) {
      setCounting(true);
      try {
        const c = await countChipsFromPhoto(blob, chipSet, expected);
        setCount(c);
        setFixed(Object.fromEntries(c.counts.map((x) => [x.color, x.count])));
        setNote("");
        setUnit("chips");
        setManual(String(c.total));
      } catch (e) {
        setErr(`לא הצלחתי לספור: ${(e as Error).message}. אפשר להזין ידנית.`);
      } finally {
        setCounting(false);
      }
    }
  }

  const typed = Number(manual) || 0;
  const total = unit === "money" ? moneyToChips(typed, rate) : typed;
  const edited = count != null && total !== count.total;
  const colourFixed = count != null && count.counts.some((c) => (fixed[c.color] ?? 0) !== c.count);

  function setColour(color: string, n: number) {
    const next = { ...fixed, [color]: Math.max(0, n) };
    setFixed(next);
    setUnit("chips");
    if (chipSet) setManual(String(chipSetTotal(chipSet.chips.map((c) => ({ color: c.color, count: next[c.color] ?? 0 })), chipSet.chips)));
  }

  function switchUnit(u: "chips" | "money") {
    if (u === unit) return;
    if (manual) setManual(String(u === "money" ? round2(chipsToMoney(total, rate)) : total));
    setUnit(u);
  }

  function finish() {
    if (count && chipSet && (colourFixed || note.trim())) {
      saveChipCorrection(chipSet, {
        detected: count.counts,
        actual: chipSet.chips.map((c) => ({ color: c.color, count: fixed[c.color] ?? 0 })),
        note,
      }).catch(() => {});
    }
    onDone({ total, photo, detected: count?.total ?? null, count, manual: !count || edited });
  }

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {preview ? (
        <div className="relative overflow-hidden rounded-2xl border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="צילום צ'יפים" className="max-h-56 w-full object-cover" />
          <button onClick={() => fileRef.current?.click()} className="glass absolute bottom-2 left-2 rounded-xl px-3 py-1.5 text-xs font-bold">
            צילום מחדש
          </button>
        </div>
      ) : (
        <button onClick={() => fileRef.current?.click()} className={`flex ${verdict ? "h-20" : "h-32"} w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-gold/40 bg-gold/5 text-gold`}>
          <Camera className="size-8" />
          <span className="text-sm font-bold">{hint}{verdict ? " (לא חובה)" : ""}</span>
          {aiOn && <span className="flex items-center gap-1 text-[11px] text-muted"><Sparkles className="size-3" /> {chipSet?.chips.some((c) => c.images?.length) ? "אספור לפי תמונות הצ'יפים של הערכה" : "אספור לפי צבעים"}</span>}
        </button>
      )}
      {!preview && aiOn && <StackPhotoGuide />}

      {counting && <div className="flex items-center justify-center gap-2 py-2 text-sm text-gold"><Sparkles className="size-4 animate-pulse" /> סופר צ'יפים...</div>}
      {(count || byColour) && (
        <Card className="space-y-2 p-3">
          {count ? (
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold">זיהיתי בתמונה</span>
            <Badge tone={count.confidence === "high" ? "win" : count.confidence === "medium" ? "warn" : "loss"}>
              ביטחון {count.confidence === "high" ? "גבוה" : count.confidence === "medium" ? "בינוני" : "נמוך"}
            </Badge>
          </div>
          ) : (
            <div className="text-sm font-bold">פירוט לפי צבעים</div>
          )}
          <div className="space-y-1.5">
            {(chipSet?.chips ?? []).map((chip) => {
              const n = fixed[chip.color] ?? 0;
              const was = count ? count.counts.find((x) => x.color === chip.color)?.count ?? 0 : n;
              return (
                <div key={chip.color} className="flex items-center gap-2">
                  <ChipDot hex={chip.hex} size={18} />
                  <span className="min-w-0 flex-1 truncate text-sm">{chip.color} <span className="num text-xs text-muted">× {chip.value}</span></span>
                  {n !== was && <span className="num text-[11px] text-muted line-through">{was}</span>}
                  <button type="button" aria-label={`פחות ${chip.color}`} className="grid size-8 place-items-center rounded-xl bg-surface-2 text-lg font-bold" onClick={() => setColour(chip.color, n - 1)}>−</button>
                  <input
                    aria-label={`כמות ${chip.color}`}
                    className={`num h-8 w-12 rounded-xl border bg-surface-2 text-center text-sm font-bold ${n !== was ? "border-gold text-gold" : "border-line"}`}
                    inputMode="numeric"
                    value={n}
                    onChange={(e) => setColour(chip.color, Number(e.target.value.replace(/\D/g, "")) || 0)}
                  />
                  <button type="button" aria-label={`עוד ${chip.color}`} className="grid size-8 place-items-center rounded-xl bg-surface-2 text-lg font-bold" onClick={() => setColour(chip.color, n + 1)}>+</button>
                </div>
              );
            })}
          </div>
          {count ? (
          <>
          <p className="text-[11px] text-muted">הזיהוי טעה? תקן את הכמות לכל צבע והסכום יתעדכן. התיקון נשמר לערכה ועוזר לזיהוי הבא.</p>
          {count.recounted && <p className="text-[11px] text-gold">הספירה הראשונה לא התאימה לבקשה, אז ספרתי שוב.</p>}
          {count.notes && <p className="text-xs text-muted">{count.notes}</p>}
          <input
            className={`${inputCls} h-10 text-sm`}
            placeholder="הערה לזיהוי הבא (לא חובה), למשל: הוורוד נראה אדום באור הזה"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
          </>
          ) : (
            <p className="text-[11px] text-muted">הסכום מתעדכן לפי הצבעים.</p>
          )}
        </Card>
      )}
      {verdict && count && expected != null && total > 0 && <Verdict expected={expected} total={total} low={count.confidence === "low"} />}
      {err && <p className="text-xs text-warn">{err}</p>}

      {!count && !counting && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span>צילום לא חובה: אפשר פשוט לרשום כמה צ&apos;יפים{verdict ? " נמסרו" : ""}.</span>
          {chipSet && !byColour && (
            <button type="button" className="shrink-0 font-bold text-gold" onClick={() => setByColour(true)}>
              פירוט לפי צבעים
            </button>
          )}
        </div>
      )}
      {rate > 0 && !verdict && (
        <div className="grid grid-cols-2 rounded-2xl bg-surface-2 p-1 text-sm font-bold" role="group" aria-label="הזנה לפי">
          {([["chips", "צ'יפים"], ["money", "סכום במזומן ₪"]] as const).map(([u, label]) => (
            <button key={u} type="button" aria-pressed={unit === u} onClick={() => switchUnit(u)} className={`rounded-xl py-2 ${unit === u ? "bg-gold text-[#1d1405]" : "text-muted"}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      <Field
        label={unit === "money" ? "סה״כ בשקלים" : "סה״כ צ'יפים"}
        hint={unit === "money" && typed ? `= ${total.toLocaleString()} צ'יפים` : edited ? "שינית את הספירה. התיקון יתועד ביומן הערב." : rate > 0 && total ? `= ${formatMoney(chipsToMoney(total, rate))}` : undefined}
      >
        <input className={`${inputCls} text-center text-2xl font-extrabold`} inputMode={unit === "money" ? "decimal" : "numeric"} value={manual} onChange={(e) => setManual(e.target.value)} placeholder={unit === "money" ? "₪0" : expected ? String(expected) : "0"} />
      </Field>

      <Button
        size="lg"
        className="w-full"
        disabled={!manual || counting}
        loading={busy}
        onClick={finish}
      >
        {cta}
      </Button>
    </div>
  );
}

function Verdict({ expected, total, low }: { expected: number; total: number; low: boolean }) {
  const v = verdictOf(expected, total, low);
  return (
    <div role="status" className={`flex items-start gap-2 rounded-2xl border p-3 ${v.tone === "win" ? "border-win/40 bg-win/10" : "border-warn/40 bg-warn/10"}`}>
      {v.tone === "win" ? <Check className="size-5 shrink-0 text-win" /> : <AlertTriangle className="size-5 shrink-0 text-warn" />}
      <div>
        <div className={`font-bold ${v.tone === "win" ? "text-win" : "text-warn"}`}>{v.title}</div>
        <div className="text-xs text-muted">{v.text}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cashier queue + handover with photo proof
// ---------------------------------------------------------------------------
export function CashierSheet({
  open, onClose, night, requests, members, chipSet, isAdmin, onHandover,
}: {
  open: boolean; onClose: () => void; night: GameNight; requests: ChipRequest[]; members: Member[]; chipSet: ChipSet | null; isAdmin: boolean; onHandover: () => void;
}) {
  const rate = chipRate(night);
  const [active, setActive] = useState<ChipRequest | null>(null);
  const [step, setStep] = useState<"count" | "mismatch">("count");
  const [result, setResult] = useState<{ total: number; path: string | null; detected: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const queue = requests.filter((r) => r.status === "pending" || r.status === "flagged");

  useEffect(() => {
    if (!open) {
      setActive(null);
      setStep("count");
      setResult(null);
      setErr(null);
    }
  }, [open]);

  async function run(f: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr(nightError(e));
    } finally {
      setBusy(false);
    }
  }

  async function approve(r: ChipRequest, given: number, extra: Partial<ChipRequest> = {}, kind = "approved") {
    const { error } = await supabase()
      .from("chip_requests")
      .update({ status: "approved", given_chips: given, approved_by: await myUid(), approved_at: new Date().toISOString(), ...extra })
      .eq("id", r.id);
    if (error) throw error;
    await logEvent(night.id, kind, { request_id: r.id, member_id: r.member_id, requested: Number(r.chips), given, detected: extra.detected_chips ?? r.detected_chips });
  }

  const onCounted = ({ total, photo, detected }: { total: number; photo: Blob | null; detected: number | null }) => run(async () => {
    if (!active) return;
    const path = photo ? await uploadPhoto(night.id, `req-${active.id}`, photo).catch(() => null) : null;
    const requested = Number(active.chips);
    if (total === requested) {
      // matches the request. If the photo saw something else and the cashier
      // fixed the count by hand, that is a logged correction, not a new question.
      const corrected = detected != null && detected !== requested;
      await approve(
        active,
        total,
        { photo_path: path, detected_chips: detected, ...(corrected ? { note: "הקופאי תיקן את ספירת התמונה" } : {}) },
        corrected ? "count_corrected" : "approved",
      );
      setActive(null);
      return;
    }
    setResult({ total, path, detected });
    setStep("mismatch");
  });

  const resolveMismatch = (choice: "actual" | "flag") => run(async () => {
    if (!active || !result) return;
    if (choice === "actual") {
      // the cashier really handed a different amount: debt follows what was handed
      await approve(active, result.total, { photo_path: result.path, detected_chips: result.detected, note: "תיקון ידני של הקופאי" }, "manual_correction");
    } else {
      // cashier says the requested amount was handed and the count is wrong: admin decides
      const { error } = await supabase()
        .from("chip_requests")
        .update({ status: "flagged", given_chips: Number(active.chips), detected_chips: result.detected ?? result.total, photo_path: result.path })
        .eq("id", active.id);
      if (error) throw error;
      await logEvent(night.id, "flagged", { request_id: active.id, member_id: active.member_id, requested: Number(active.chips), detected: result.detected ?? result.total });
    }
    setActive(null);
    setStep("count");
  });

  const reject = (r: ChipRequest) => run(async () => {
    const { error } = await supabase().from("chip_requests").update({ status: "rejected" }).eq("id", r.id);
    if (error) throw error;
    await logEvent(night.id, "rejected", { request_id: r.id, member_id: r.member_id });
  });

  if (active) {
    const requested = Number(active.chips);
    return (
      <Sheet open={open} onClose={() => setActive(null)} title={`מסירה ל${nameOf(members, active.member_id)}`}>
        {step === "count" ? (
          <div className="space-y-4">
            <Card className="text-center">
              <div className="text-xs text-muted">ביקש</div>
              <div className="num font-[family-name:var(--font-display)] text-3xl font-extrabold">{requested.toLocaleString()} צ'יפים</div>
              <div className="num text-sm text-muted">{formatMoney(chipsToMoney(requested, rate))}</div>
              {chipSet && (
                <div className="mt-3">
                  <div className="mb-1.5 text-xs text-muted">הצעה למה לתת</div>
                  <Breakdown total={requested} chipSet={chipSet} />
                </div>
              )}
            </Card>
            <ChipCounter chipSet={chipSet} expected={requested} cta="מסרתי, אישור" busy={busy} onDone={onCounted} verdict hint="צלם מהצד את הצ'יפים שאתה מוסר" />
            {err && <p className="text-sm text-loss">{err}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4">
              <AlertTriangle className="size-6 shrink-0 text-warn" />
              <div>
                <div className="font-bold text-warn">הסכום לא תואם לבקשה</div>
                <div className="num mt-1 text-sm">
                  ביקש {requested.toLocaleString()} · {result?.detected != null ? `בתמונה זוהו ${result.detected.toLocaleString()}` : `נספרו ${result?.total.toLocaleString()}`}
                </div>
              </div>
            </div>
            <Button className="w-full" variant="soft" loading={busy} onClick={() => resolveMismatch("actual")}>
              <Pencil className="size-4" /> מסרתי בפועל {result?.total.toLocaleString()}, לרשום את זה
            </Button>
            <Button className="w-full" variant="soft" loading={busy} onClick={() => resolveMismatch("flag")}>
              <AlertTriangle className="size-4" /> מסרתי {requested.toLocaleString()}, הזיהוי שגוי. שלח לאישור מנהל
            </Button>
            <Button className="w-full" variant="ghost" onClick={() => setStep("count")}>
              ספירה מחדש
            </Button>
            {err && <p className="text-sm text-loss">{err}</p>}
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="קופה">
      {queue.length === 0 ? (
        <div className="py-8 text-center text-muted">אין בקשות פתוחות 👌</div>
      ) : (
        <div className="space-y-2">
          {queue.map((r) => (
            <Card key={r.id} className={`space-y-3 ${r.status === "flagged" ? "border-warn/40" : ""}`}>
              <div className="flex items-center gap-3">
                <Avatar name={nameOf(members, r.member_id)} src={members.find((m) => m.id === r.member_id)?.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{nameOf(members, r.member_id)}</div>
                  <div className="num text-sm text-muted">
                    {Number(r.chips).toLocaleString()} צ'יפים · {formatMoney(chipsToMoney(Number(r.chips), rate))}
                  </div>
                </div>
                <PhotoThumb path={r.photo_path} />
              </div>
              {r.status === "flagged" ? (
                <>
                  <div className="rounded-xl bg-warn/10 p-2 text-xs text-warn">
                    הקופאי מסר {Number(r.given_chips).toLocaleString()}, בתמונה זוהו {Number(r.detected_chips).toLocaleString()}
                  </div>
                  {isAdmin ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" disabled={busy} onClick={() => run(() => approve(r, Number(r.given_chips), {}, "admin_approved"))}>
                        <Check className="size-4" /> תקין, {Number(r.given_chips).toLocaleString()}
                      </Button>
                      <Button size="sm" variant="soft" disabled={busy} onClick={() => run(() => approve(r, Number(r.detected_chips), {}, "admin_corrected"))}>
                        לפי התמונה, {Number(r.detected_chips).toLocaleString()}
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-muted">ממתין לאישור מנהל</div>
                  )}
                </>
              ) : (
                <div className="flex gap-2">
                  {/* the usual path: hand the chips and confirm, no photo */}
                  <Button size="sm" className="flex-1" disabled={busy} onClick={() => run(() => approve(r, Number(r.chips), { note: "אושר בלי צילום" }))}>
                    <Check className="size-4" /> מסרתי {Number(r.chips).toLocaleString()}
                  </Button>
                  <Button size="sm" variant="soft" aria-label="מסירה וצילום" title="מסירה עם צילום או סכום אחר" onClick={() => { setErr(null); setActive(r); }}>
                    <Camera className="size-4" />
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => reject(r)} aria-label="דחייה">
                    <X className="size-4" />
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {err && <p className="mt-3 text-sm text-loss">{err}</p>}
      <Button variant="ghost" className="mt-4 w-full" onClick={onHandover}>
        <ArrowLeftRight className="size-4" /> החלפת קופאי (ספירה והעברת הקופה)
      </Button>
    </Sheet>
  );
}


// ---------------------------------------------------------------------------
// Results: food fee and corrections after the count
// ---------------------------------------------------------------------------
export const foodFeeOf = (night: GameNight) => Number(night.food_fee ?? 0);

/** Food fee per member for this night (players who are in the night, minus the host). */
export function nightFood(night: GameNight, players: Pick<NightPlayer, "member_id">[]) {
  return foodCharges(players.map((p) => p.member_id), foodFeeOf(night), night.host_member_id);
}

/** The settle mode a correction uses: the one chosen at the close. */
export function nightSettleMode(night: GameNight, table: PokerTable | null): SettleMode {
  const m = night.settle_mode ?? table?.last_settings?.settle_mode;
  return m === "cashier" && night.cashier_member_id ? "cashier" : "players";
}

/**
 * A closed night after a correction (a count, a purchase, the food fee):
 * recalculate every result the same way the close did and rewrite the
 * transfers. A transfer that comes out the same keeps its "paid" mark.
 */
export async function recalcClosedNight({
  night, players, requests, settlements, table, finalChips = {}, given = {}, foodFee, hostId,
}: {
  night: GameNight; players: NightPlayer[]; requests: ChipRequest[]; settlements: Settlement[]; table: PokerTable | null;
  finalChips?: Record<string, number>; given?: Record<string, number>; foodFee?: number; hostId?: string | null;
}): Promise<NightResult> {
  const sb = supabase();
  const ok = <T extends { error: unknown }>(r: T) => {
    if (r.error) throw r.error;
    return r;
  };
  const ps = players.map((p) => (finalChips[p.member_id] != null ? { ...p, final_chips: finalChips[p.member_id] } : p));
  const rs = requests.map((r) => (given[r.id] != null ? { ...r, given_chips: given[r.id] } : r));
  const lines = playerLines(night, ps, rs);
  const fee = foodFee ?? foodFeeOf(night);
  const host = hostId !== undefined ? hostId : night.host_member_id ?? null;
  const result = nightResult(
    ps.map((p) => ({ id: p.member_id, status: p.status, finalChips: Number(p.final_chips ?? 0), boughtMoney: lines.find((l) => l.member_id === p.member_id)!.boughtMoney })),
    chipRate(night),
    { foodFee: fee, hostId: host, mode: nightSettleMode(night, table), cashierId: night.cashier_member_id },
  );
  for (const p of ps) {
    const bought = lines.find((l) => l.member_id === p.member_id)!.boughtMoney;
    const net = result.poker.find((x) => x.id === p.member_id)!.net;
    if (Number(p.net) !== net || Number(p.bought_money) !== bought || finalChips[p.member_id] != null) {
      ok(await sb.from("night_players").update({ final_chips: p.final_chips, bought_money: bought, net }).eq("id", p.id));
    }
  }
  if (foodFee !== undefined || hostId !== undefined) {
    ok(await sb.from("game_nights").update({ food_fee: fee, host_member_id: host }).eq("id", night.id));
  }
  const paid = (t: { from: string; to: string; amount: number }) =>
    settlements.find((s) => s.paid && s.from_member === t.from && s.to_member === t.to && Number(s.amount) === t.amount);
  ok(await sb.from("settlements").delete().eq("night_id", night.id));
  if (result.transfers.length) {
    ok(await sb.from("settlements").insert(result.transfers.map((t) => {
      const was = paid(t);
      return { night_id: night.id, from_member: t.from, to_member: t.to, amount: t.amount, paid: !!was, paid_at: was?.paid_at ?? null };
    })));
  }
  return result;
}

/** Food fee and host, editable by the admin while the night is open and after it closed. */
export function FoodFeeEditor({
  fee, hostId, members, onSave, compact = false,
}: {
  fee: number; hostId: string | null; members: Member[]; onSave: (fee: number, hostId: string | null) => Promise<void>; compact?: boolean;
}) {
  const [amount, setAmount] = useState(fee ? String(fee) : "");
  const [host, setHost] = useState(hostId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setAmount(fee ? String(fee) : "");
    setHost(hostId ?? "");
  }, [fee, hostId]);
  const changed = (Number(amount) || 0) !== fee || (host || null) !== (hostId || null);
  const active = members.filter((m) => m.status === "active" || m.id === hostId);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await onSave(Number(amount) || 0, host || null);
    } catch (e) {
      setErr(nightError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={compact ? "space-y-2" : "space-y-2 rounded-2xl bg-surface-2 p-3"}>
      <div className="text-sm font-bold">🍽️ דמי אוכל</div>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <input aria-label="דמי אוכל לשחקן (₪)" className={`${inputCls} h-11 text-center`} inputMode="decimal" placeholder="₪0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        <select aria-label="מארח" className={`${inputCls} h-11`} value={host} onChange={(e) => setHost(e.target.value)}>
          <option value="">בלי מארח</option>
          {active.map((m) => (
            <option key={m.id} value={m.id}>מארח: {m.display_name}</option>
          ))}
        </select>
      </div>
      <p className="text-[11px] text-muted">
        {Number(amount) > 0 && host
          ? `כל שחקן חוץ מהמארח משלם ${formatMoney(Number(amount))} למארח. זה נפרד מהצ'יפים ונכנס רק להתחשבנות בסוף.`
          : Number(amount) > 0
            ? "בחר מי המארח: הוא לא משלם ומקבל את דמי האוכל."
            : "סכום לשחקן שמשולם למארח, בנפרד מהצ'יפים."}
      </p>
      {changed && (
        <Button size="sm" className="w-full" loading={busy} onClick={save}>
          <Check className="size-4" /> שמירת דמי אוכל
        </Button>
      )}
      {err && <p className="text-xs text-loss">{err}</p>}
    </div>
  );
}

/** What a player owes or gets with the food fee next to the poker result, so nothing is hidden. */
function FoodBreakdown({ night, players, memberId, net, members }: { night: GameNight; players: NightPlayer[]; memberId: string; net: number | null; members: Member[] }) {
  const food = nightFood(night, players);
  const f = food[memberId];
  if (!f) return null;
  if (memberId === night.host_member_id) {
    return (
      <div className="rounded-2xl bg-surface-2 p-3 text-sm">
        🍽️ מארח הערב: מקבל {formatMoney(f)} דמי אוכל ({Object.values(food).filter((x) => x < 0).length} × {formatMoney(foodFeeOf(night))})
        {net != null && <div className="mt-1 font-bold">סה״כ בהתחשבנות: {formatSigned(round2(net + f))}</div>}
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-2xl bg-surface-2 p-3 text-sm">
      {net != null && (
        <div className="flex justify-between"><span className="text-muted">תוצאה במשחק</span><span className="num font-bold">{formatSigned(net)}</span></div>
      )}
      <div className="flex justify-between">
        <span className="text-muted">🍽️ דמי אוכל{night.host_member_id ? ` (ל${nameOf(members, night.host_member_id)})` : ""}</span>
        <span className="num font-bold">{formatSigned(f)}</span>
      </div>
      {net != null ? (
        <div className="flex justify-between border-t border-line pt-1"><span className="font-bold">סה״כ בהתחשבנות</span><span className={`num font-extrabold ${net + f >= 0 ? "text-win" : "text-loss"}`}>{formatSigned(round2(net + f))}</span></div>
      ) : (
        <div className="text-[11px] text-muted">נוסף לחשבון הסופי, בנפרד מהצ'יפים.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One player's details: purchases with photos, cash out
// ---------------------------------------------------------------------------
export function PlayerSheet({
  onClose, night, memberId, players, requests, members, lines, chipSet, canManage, onRequest, isAdmin = false, settlements = [], table = null,
}: {
  onClose: () => void; night: GameNight; memberId: string; players: NightPlayer[]; requests: ChipRequest[]; members: Member[]; lines: PlayerLine[]; chipSet: ChipSet | null; canManage: boolean;
  /** admin/cashier: open a chip request for this player (guests and anyone not using the app) */
  onRequest?: () => void;
  /** the admin corrects counts and purchases, also after the night closed */
  isAdmin?: boolean; settlements?: Settlement[]; table?: PokerTable | null;
}) {
  const rate = chipRate(night);
  const p = players.find((x) => x.member_id === memberId);
  const l = lines.find((x) => x.member_id === memberId);
  const mine = requests.filter((r) => r.member_id === memberId && r.status !== "rejected");
  const [mode, setMode] = useState<null | "cashout" | "fix">(null);
  const [editReq, setEditReq] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!p || !l) return null;
  const closed = night.status === "closed";
  // chips the admin still has to decide on would change the debt after the cash-out
  const flagged = mine.filter((r) => r.status === "flagged").length;
  const waiting = mine.filter((r) => r.status === "pending").length;
  const hasResult = p.status === "out" || closed;
  const net = hasResult ? Number(p.net ?? l.net ?? 0) : null;
  // a wrong count can be fixed after a cash-out (admin or cashier) and after the close (admin)
  const canFixCount = (!closed && canManage && p.status === "out") || (closed && isAdmin);
  const canFixBuy = isAdmin;

  async function run(f: () => Promise<void>, msg: string) {
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      await f();
      setDone(msg);
    } catch (e) {
      setErr(nightError(e));
    } finally {
      setBusy(false);
    }
  }

  const doCashout = ({ total, photo, detected, manual }: { total: number; photo: Blob | null; detected: number | null; manual: boolean }) =>
    run(async () => {
      const path = photo ? await uploadPhoto(night.id, `out-${memberId}`, photo).catch(() => null) : null;
      const n = round2(chipsToMoney(total, rate) - l!.boughtMoney);
      const { error } = await supabase()
        .from("night_players")
        .update({ status: "out", final_chips: total, final_photo_path: path, left_at: new Date().toISOString(), bought_money: l!.boughtMoney, net: n })
        .eq("id", p!.id);
      if (error) throw error;
      await logEvent(night.id, "cashout", { member_id: memberId, chips: total, detected, manual, net: n });
      // stay on the player: the result and the food fee show right away
      setMode(null);
    }, "החשבון נסגר");

  const fixCount = ({ total, photo }: { total: number; photo: Blob | null }) =>
    run(async () => {
      const from = Number(p!.final_chips ?? 0);
      if (closed) {
        await recalcClosedNight({ night, players, requests, settlements, table, finalChips: { [memberId]: total } });
      } else {
        const path = photo ? await uploadPhoto(night.id, `out-${memberId}`, photo).catch(() => null) : null;
        const bought = l!.boughtMoney;
        const { error } = await supabase()
          .from("night_players")
          .update({ final_chips: total, net: round2(chipsToMoney(total, rate) - bought), bought_money: bought, ...(path ? { final_photo_path: path } : {}) })
          .eq("id", p!.id);
        if (error) throw error;
      }
      await logEvent(night.id, "count_edited", { member_id: memberId, from, to: total, after_close: closed });
      setMode(null);
    }, closed ? "הספירה תוקנה וההעברות חושבו מחדש" : "הספירה תוקנה");

  const fixPurchase = (r: ChipRequest) =>
    run(async () => {
      const to = Math.round(Number(editVal));
      if (!(to >= 0)) throw new Error("כמות לא תקינה");
      const from = Number(r.given_chips ?? r.chips);
      const sb = supabase();
      const { error } = await sb.from("chip_requests").update({ given_chips: to }).eq("id", r.id);
      if (error) throw error;
      if (closed) {
        await recalcClosedNight({ night, players, requests, settlements, table, given: { [r.id]: to } });
      } else if (p!.status === "out") {
        const bought = round2(l!.boughtMoney + chipsToMoney(to - from, rate));
        const { error: e2 } = await sb.from("night_players").update({ bought_money: bought, net: round2(chipsToMoney(Number(p!.final_chips ?? 0), rate) - bought) }).eq("id", p!.id);
        if (e2) throw e2;
      }
      await logEvent(night.id, "purchase_edited", { member_id: memberId, request_id: r.id, from, to, after_close: closed });
      setEditReq(null);
    }, "הקנייה תוקנה");

  async function undoCashout() {
    const { error } = await supabase().from("night_players").update({ status: "playing", final_chips: null, left_at: null, net: null, bought_money: null }).eq("id", p!.id);
    if (error) return setErr(nightError(error));
    await logEvent(night.id, "cashout_undone", { member_id: memberId });
    onClose();
  }

  if (mode) {
    const fixing = mode === "fix";
    return (
      <Sheet open onClose={() => setMode(null)} title={`${fixing ? "תיקון ספירה" : "קם מהשולחן"}: ${nameOf(members, memberId)}`}>
        <div className="space-y-3">
          {fixing ? (
            <p className="text-sm text-muted">
              נספרו {Number(p.final_chips ?? 0).toLocaleString()} צ&apos;יפים. מזינים את הספירה הנכונה, בצ&apos;יפים או בסכום במזומן.
              {closed ? " התוצאות וההעברות של הערב יחושבו מחדש." : ""} התיקון נרשם ביומן הערב.
            </p>
          ) : (
            <p className="text-sm text-muted">ספירת הצ&apos;יפים של {nameOf(members, memberId)} ביציאה מהשולחן. אפשר לרשום צ&apos;יפים או סכום במזומן. החוב שלו ייסגר לפי הספירה ולא יתווסף לו חוב בהמשך הערב.</p>
          )}
          {!fixing && waiting > 0 && <p className="rounded-xl bg-warn/10 p-2 text-xs text-warn">יש לו {waiting} בקשות שעוד לא נמסרו. הן יבוטלו כשהוא קם.</p>}
          {!fixing && foodFeeOf(night) > 0 && nightFood(night, players)[memberId] < 0 && (
            <p className="rounded-xl bg-surface-2 p-2 text-xs text-muted">🍽️ דמי אוכל {formatMoney(foodFeeOf(night))} נוספים לחשבון הסופי שלו, בנפרד מהצ&apos;יפים.</p>
          )}
          <ChipCounter chipSet={chipSet} rate={rate} initial={fixing ? Number(p.final_chips ?? 0) : null} cta={fixing ? "שמירת התיקון" : "סגירת החשבון שלו"} busy={busy} onDone={fixing ? fixCount : doCashout} />
          {err && <p className="text-sm text-loss">{err}</p>}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={nameOf(members, memberId)}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="קנה" value={formatMoney(l.boughtMoney)} />
          <Stat label={hasResult ? "סיים עם" : "צ'יפים"} value={(hasResult ? Number(p.final_chips ?? 0) : l.boughtChips).toLocaleString()} />
          <Stat label={hasResult ? "תוצאה" : "כניסות"} value={hasResult ? formatSigned(net) : `${+l.buyins.toFixed(1)}`} tone={hasResult ? ((net ?? 0) >= 0 ? "win" : "loss") : undefined} />
        </div>
        <FoodBreakdown night={night} players={players} memberId={memberId} net={net} members={members} />
        {done && (
          <p role="status" className="flex items-center gap-1 rounded-xl bg-win/10 p-2 text-sm font-bold text-win">
            <Check className="size-4" /> {done}
          </p>
        )}
        {canFixCount && (
          <Button variant="soft" className="w-full" onClick={() => setMode("fix")}>
            <Pencil className="size-4" /> תיקון ספירה ({Number(p.final_chips ?? 0).toLocaleString()} צ&apos;יפים)
          </Button>
        )}
        <div className="space-y-2">
          {mine.length === 0 && <div className="py-4 text-center text-sm text-muted">עוד לא קנה צ'יפים</div>}
          {mine.map((r) =>
            editReq === r.id ? (
              <div key={r.id} className="space-y-2 rounded-2xl border border-gold/50 bg-surface-2 p-3">
                <div className="text-xs text-muted">כמה צ&apos;יפים הוא קיבל בפועל? (ביקש {Number(r.chips).toLocaleString()})</div>
                <div className="flex gap-2">
                  <input aria-label="צ'יפים שנמסרו" autoFocus className={`${inputCls} h-11 text-center font-bold`} inputMode="numeric" value={editVal} onChange={(e) => setEditVal(e.target.value.replace(/\D/g, ""))} />
                  <Button size="md" loading={busy} disabled={editVal === ""} onClick={() => fixPurchase(r)}>שמירה</Button>
                  <Button size="md" variant="ghost" onClick={() => setEditReq(null)} aria-label="ביטול"><X className="size-4" /></Button>
                </div>
                {editVal !== "" && <div className="num text-xs text-muted">= {formatMoney(chipsToMoney(Number(editVal), rate))}{closed ? " · ההעברות יחושבו מחדש" : ""}</div>}
              </div>
            ) : (
              <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                <PhotoThumb path={night.photos_purged ? null : r.photo_path} />
                <div className="min-w-0 flex-1">
                  <div className="num font-bold">
                    {Number(r.given_chips ?? r.chips).toLocaleString()} צ'יפים · {formatMoney(chipsToMoney(Number(r.given_chips ?? r.chips), rate))}
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(r.created_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                    {r.note ? ` · ${r.note}` : ""}
                    {r.given_chips != null && Number(r.given_chips) !== Number(r.chips) ? ` · ביקש ${Number(r.chips).toLocaleString()}` : ""}
                  </div>
                </div>
                <Badge tone={r.status === "approved" ? "win" : r.status === "flagged" ? "warn" : "muted"}>
                  {r.status === "approved" ? "נמסר" : r.status === "flagged" ? "לבדיקה" : "ממתין"}
                </Badge>
                {canFixBuy && r.status === "approved" && (
                  <button className="grid size-8 shrink-0 place-items-center rounded-xl bg-surface text-muted" aria-label="תיקון הקנייה" onClick={() => { setEditReq(r.id); setEditVal(String(Number(r.given_chips ?? r.chips))); setDone(null); }}>
                    <Pencil className="size-3.5" />
                  </button>
                )}
              </div>
            ),
          )}
        </div>
        {p.final_photo_path && !night.photos_purged && (
          <div className="flex items-center gap-3 text-sm text-muted">
            <PhotoThumb path={p.final_photo_path} /> צילום ספירת הסיום ({Number(p.final_chips).toLocaleString()} צ'יפים)
          </div>
        )}
        {canManage && !closed && p.status === "playing" && onRequest && (
          <Button className="w-full" onClick={onRequest}>
            <HandCoins className="size-4" /> רישום צ'יפים שנמסרו לו
          </Button>
        )}
        {canManage && !closed && p.status === "playing" && flagged > 0 && (
          <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">
            יש מסירה שממתינה לאישור מנהל. קודם מחליטים עליה בקופה, ואז אפשר לסגור לו חשבון.
          </p>
        )}
        {canManage && !closed && p.status === "playing" && (
          <Button variant="soft" className="w-full" disabled={flagged > 0} onClick={() => setMode("cashout")}>
            <LogOut className="size-4" /> קם מהשולחן: ספירה וסגירת חוב
          </Button>
        )}
        {err && <p className="text-sm text-loss">{err}</p>}
        {canManage && !closed && p.status === "out" && (
          <Button variant="ghost" className="w-full" onClick={undoCashout}>
            חזר לשחק (ביטול יציאה)
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "win" | "loss" }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <div className={`num text-lg font-extrabold ${tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : ""}`}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: change cashier, add a player mid-night
// ---------------------------------------------------------------------------
export function AdminSheet({
  open, onClose, night, players, members, requests = [], onHandover, onCashout, table, onBackToSignup, onDelete, onRename,
}: {
  open: boolean; onClose: () => void; night: GameNight; players: NightPlayer[]; members: Member[]; requests?: ChipRequest[];
  onHandover: () => void; onCashout: (memberId: string) => void;
  table?: PokerTable | null; onBackToSignup?: () => void; onDelete?: () => void; onRename?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const inviteLink = table && typeof window !== "undefined" ? `${location.origin}/join/${table.code}` : "";
  const inviteText = table ? `ערב פוקר עכשיו בשולחן "${table.name}" 🃏 נכנסים עם גוגל דרך הקישור ומצטרפים: ${inviteLink}` : "";
  const handedOut = requests.some((r) => r.status === "approved" || r.status === "flagged");
  const outside = members.filter((m) => m.status === "active" && !players.some((p) => p.member_id === m.id));
  const playing = players.filter((p) => p.status === "playing");
  const [guest, setGuest] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const hasCashier = !!night.cashier_member_id;

  async function run(key: string, f: () => Promise<void>) {
    setBusy(key);
    setErr("");
    try {
      await f();
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message;
      setErr(msg?.includes("table is full") ? "השולחן מלא (עד 10 שחקנים)." : msg || "משהו השתבש, נסה שוב");
    } finally {
      setBusy(null);
    }
  }
  const nextSeat = () => Math.max(-1, ...players.map((p) => p.seat)) + 1;

  const setCashier = (id: string) =>
    run(`cashier:${id}`, async () => {
      const { error } = await supabase().from("game_nights").update({ cashier_member_id: id }).eq("id", night.id);
      if (error) throw error;
      await logEvent(night.id, "cashier_changed", { member_id: id });
    });
  async function seat(memberId: string) {
    const { error } = await supabase().from("night_players").insert({ night_id: night.id, member_id: memberId, seat: nextSeat(), arrived_at: new Date().toISOString() });
    if (error) throw error;
    await logEvent(night.id, "player_added", { member_id: memberId });
  }
  const addPlayer = (id: string) => run(`add:${id}`, () => seat(id));
  const addGuest = () =>
    run("guest", async () => {
      const name = guest.trim();
      if (!name) return;
      const data = await addGuestByName(night.table_id, name);
      if (players.some((p) => p.member_id === data.id)) throw new Error(`${data.display_name} כבר בערב`);
      await seat(data.id);
      setGuest("");
    });
  // A player who already got chips leaves through a cash-out, so the night stays balanced.
  // One who got nothing yet (added by mistake, never sat down) is simply taken off.
  const remove = (p: NightPlayer) =>
    run(`remove:${p.member_id}`, async () => {
      const mine = requests.filter((r) => r.member_id === p.member_id);
      if (mine.some((r) => r.status === "approved" || r.status === "flagged")) {
        onCashout(p.member_id);
        return;
      }
      const pendingIds = mine.filter((r) => r.status === "pending").map((r) => r.id);
      if (pendingIds.length) await supabase().from("chip_requests").update({ status: "rejected" }).in("id", pendingIds);
      const { error } = await supabase().from("night_players").delete().eq("id", p.id);
      if (error) throw error;
      await logEvent(night.id, "player_removed", { member_id: p.member_id });
    });
  const bought = (memberId: string) => requests.some((r) => r.member_id === memberId && (r.status === "approved" || r.status === "flagged"));

  return (
    <Sheet open={open} onClose={onClose} title="ניהול הערב">
      <div className="space-y-6">
        {table && (
          <section>
            <h3 className="mb-2 text-sm font-bold text-muted">הזמנת חברים לערב</h3>
            <div className="flex gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(inviteText)}`} target="_blank" rel="noreferrer" className="flex-1">
                <Button className="w-full" variant="soft">
                  <Share2 className="size-4" /> הזמנה בוואטסאפ
                </Button>
              </a>
              <Button
                variant="soft"
                aria-label="העתקת קישור הזמנה"
                onClick={async () => {
                  await navigator.clipboard?.writeText(inviteLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">מי שנכנס מהקישור מצטרף לשולחן ומופיע למטה ב&quot;הוספת שחקן באמצע הערב&quot;.</p>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-bold text-muted">{hasCashier ? "קופאי" : "מינוי קופאי"}</h3>
          {hasCashier && (
            <Button className="mb-3 w-full" onClick={onHandover}>
              <ArrowLeftRight className="size-4" /> העברת הקופה לקופאי אחר (עם ספירה)
            </Button>
          )}
          <p className="mb-2 text-xs text-muted">{hasCashier ? "או מינוי מהיר בלי ספירת קופה:" : "בחר מי מחזיק את הקופה הערב:"}</p>
          <div className="flex flex-wrap gap-2">
            {playing.map((p) => (
              <button
                key={p.member_id}
                disabled={!!busy}
                onClick={() => setCashier(p.member_id)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${night.cashier_member_id === p.member_id ? "bg-gold text-[#1d1405]" : "bg-surface-2"}`}
              >
                <Landmark className="size-3.5" /> {nameOf(members, p.member_id)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-bold text-muted">שחקנים בערב</h3>
          <p className="mb-2 text-xs text-muted">מי שכבר קיבל צ&apos;יפים יוצא ב&quot;יציאה ופדיון&quot;: סופרים לו את הצ&apos;יפים וסוגרים חוב. &quot;הסרה מהערב&quot; רק למי שלא קיבל כלום, והוא נשאר חבר בשולחן.</p>
          <div className="space-y-2">
            {playing.map((p) => {
              const m = members.find((x) => x.id === p.member_id);
              const isCashier = night.cashier_member_id === p.member_id;
              return (
                <div key={p.member_id} className="flex items-center gap-3">
                  <Avatar name={m?.display_name ?? "?"} src={m?.avatar_url} size={34} />
                  <span className="flex-1 font-bold">
                    {m?.display_name ?? "?"} {isCashier && <Landmark className="inline size-3.5 text-gold" />}
                  </span>
                  {isCashier ? (
                    <span className="text-xs text-muted">קודם ממנים קופאי אחר</span>
                  ) : (
                    <Button size="sm" variant="soft" loading={busy === `remove:${p.member_id}`} disabled={!!busy} onClick={() => remove(p)}>
                      {bought(p.member_id) ? <LogOut className="size-4" /> : <Trash2 className="size-4" />}
                      {bought(p.member_id) ? "יציאה ופדיון" : "הסרה מהערב"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <FoodFeeEditor
            fee={foodFeeOf(night)}
            hostId={night.host_member_id ?? null}
            members={members}
            onSave={async (fee, hostId) => {
              const { error } = await supabase().from("game_nights").update({ food_fee: fee, host_member_id: hostId }).eq("id", night.id);
              if (error) throw error;
              await logEvent(night.id, "food_fee_changed", { fee, host: hostId });
            }}
          />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-bold text-muted">הוספת שחקן באמצע הערב</h3>
          {playing.length >= 10 ? (
            <p className="text-sm text-muted">השולחן מלא (10 שחקנים). שחקן חדש נכנס כשמישהו קם.</p>
          ) : (
          <>
          {outside.length > 0 && (
            <div className="mb-3 space-y-2">
              {outside.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <Avatar name={m.display_name} src={m.avatar_url} size={34} />
                  <span className="flex-1 font-bold">{m.display_name}</span>
                  <Button size="sm" variant="soft" loading={busy === `add:${m.id}`} disabled={!!busy} onClick={() => addPlayer(m.id)}>
                    <UserPlus className="size-4" /> הוספה
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input className={`${inputCls} h-11`} placeholder="אורח חדש (רק שם)" value={guest} onChange={(e) => setGuest(e.target.value)} />
            <Button size="md" variant="soft" loading={busy === "guest"} disabled={!guest.trim() || !!busy} onClick={addGuest}>
              <UserPlus className="size-4" /> הוספה
            </Button>
          </div>
          </>
          )}
        </section>
        {err && <p className="text-sm text-loss">{err}</p>}

        {(onBackToSignup || onDelete) && (
          <section className="space-y-2 border-t border-line pt-4">
            <h3 className="text-sm font-bold text-muted">שינוי תוכניות</h3>
            {onRename && (
              <Button className="w-full" variant="soft" onClick={onRename}>
                <Pencil className="size-4" /> {night.name ? `שם הערב: ${night.name}` : "מתן שם לערב"}
              </Button>
            )}
            {onBackToSignup && (
              <>
                <Button className="w-full" variant="soft" disabled={handedOut} onClick={onBackToSignup}>
                  <Undo2 className="size-4" /> חזרה לשלב ההרשמה
                </Button>
                <p className="text-xs text-muted">
                  {handedOut
                    ? "כבר חולקו צ'יפים בערב הזה, אז אי אפשר לחזור להרשמה. אפשר לסיים אותו או למחוק אותו."
                    : "הערב מתבטל ונפתחת שוב ההרשמה עם כל השחקנים במקומות שלהם וההגדרות של הערב."}
                </p>
              </>
            )}
            {onDelete && (
              <Button className="w-full" variant="danger" onClick={onDelete}>
                <Trash2 className="size-4" /> מחיקת הערב
              </Button>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}

/** Confirms deleting a night (running or closed): it cannot be undone. */
export function DeleteNightSheet({
  open, onClose, night, playersCount, settlementsCount, onConfirm,
}: {
  open: boolean; onClose: () => void; night: GameNight; playersCount: number; settlementsCount: number; onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const closed = night.status === "closed";
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="מחיקת הערב">
      <div className="space-y-4">
        <p className="text-sm">זה לא הפיך. יימחקו מהערב:</p>
        <ul className="list-disc space-y-1 pr-5 text-sm text-muted">
          <li>{playersCount} שחקנים, כל בקשות הצ&apos;יפים, הספירות והיומן</li>
          {closed && <li>{settlementsCount ? `${settlementsCount} העברות כסף (חובות) של הערב, גם אם לא שולמו` : "ההתחשבנות של הערב"}</li>}
          <li>התוצאות של הערב בסטטיסטיקה ובהיסטוריה</li>
        </ul>
        {err && <p className="text-sm text-loss">{err}</p>}
        <Button
          variant="danger"
          size="lg"
          className="w-full"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              await onConfirm();
            } catch (e) {
              setErr((e as { message?: string }).message ?? "המחיקה נכשלה");
              setBusy(false);
            }
          }}
        >
          <Trash2 className="size-5" /> מחיקה לצמיתות
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// End of night: count everyone, check the gap, settle and close
// ---------------------------------------------------------------------------
export function CloseSheet({
  open, onClose, night, players, lines, members, chipSet, pendingCount, flaggedCount = 0, handovers = [], table, onPlayer,
}: {
  open: boolean; onClose: () => void; night: GameNight; players: NightPlayer[]; lines: PlayerLine[]; members: Member[]; chipSet: ChipSet | null; pendingCount: number; flaggedCount?: number; handovers?: CashierHandover[]; table: PokerTable;
  /** open a player who already left, to fix their count before closing */
  onPlayer?: (memberId: string) => void;
}) {
  const rate = chipRate(night);
  const cashierId = night.cashier_member_id;
  const [mode, setMode] = useState<SettleMode>(table.last_settings?.settle_mode === "cashier" && cashierId ? "cashier" : "players");
  // expected but never came and got nothing: not counted, taken off the night when it closes
  const noShow = (p: NightPlayer) => p.status === "playing" && !p.arrived_at && !(lines.find((l) => l.member_id === p.member_id)?.boughtChips || lines.find((l) => l.member_id === p.member_id)?.pendingChips);
  const noShows = players.filter(noShow);
  const playing = players.filter((p) => p.status === "playing" && !noShow(p));
  const [counts, setCounts] = useState<Record<string, { total: number; photo: Blob | null }>>({});
  const [counting, setCounting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allCounted = playing.every((p) => counts[p.member_id] != null);
  const { handed, counted, gap: gapChips } = chipCheck(
    lines,
    players,
    Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, c.total])),
  );
  const handoverGaps = handovers.filter((h) => Number(h.gap_chips) !== 0);

  const out = players.filter((p) => p.status === "out");
  const preview = useMemo(() => {
    if (!allCounted) return null;
    const rows = [
      ...out.map((p) => ({ id: p.member_id, status: "out" as const, finalChips: Number(p.final_chips ?? 0), boughtMoney: Number(p.bought_money ?? lines.find((x) => x.member_id === p.member_id)?.boughtMoney ?? 0) })),
      ...playing.map((p) => ({ id: p.member_id, status: "playing" as const, finalChips: counts[p.member_id].total, boughtMoney: lines.find((x) => x.member_id === p.member_id)!.boughtMoney })),
    ];
    return nightResult(rows, rate, { foodFee: foodFeeOf(night), hostId: night.host_member_id, mode, cashierId });
  }, [allCounted, out, playing, lines, counts, rate, mode, cashierId, night]);
  const food = preview?.food ?? {};
  const foodPayers = Object.values(food).filter((x) => x < 0).length;

  async function finish() {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      await closeNight(preview);
      onClose();
    } catch (e) {
      setErr(`הסגירה לא הושלמה: ${nightError(e)}. אפשר לנסות שוב.`);
    } finally {
      setBusy(false);
    }
  }

  async function closeNight(preview: NightResult) {
    const sb = supabase();
    const ok = <T extends { error: unknown }>(r: T) => {
      if (r.error) throw r.error;
      return r;
    };
    if (noShows.length) {
      ok(await sb.from("night_players").delete().in("id", noShows.map((p) => p.id)));
      await logEvent(night.id, "no_shows_removed", { member_ids: noShows.map((p) => p.member_id) });
    }
    for (const p of playing) {
      const c = counts[p.member_id];
      const l = lines.find((x) => x.member_id === p.member_id)!;
      const path = c.photo ? await uploadPhoto(night.id, `final-${p.member_id}`, c.photo).catch(() => null) : null;
      ok(
        await sb
          .from("night_players")
          .update({ final_chips: c.total, final_photo_path: path, bought_money: l.boughtMoney, net: preview.poker.find((n) => n.id === p.member_id)!.net })
          .eq("id", p.id),
      );
    }
    // a retry after a failed close must not leave the transfers twice
    ok(await sb.from("settlements").delete().eq("night_id", night.id));
    if (preview.transfers.length) {
      ok(await sb.from("settlements").insert(preview.transfers.map((t) => ({ night_id: night.id, from_member: t.from, to_member: t.to, amount: t.amount }))));
    }
    await logEvent(night.id, "night_closed", { gap_chips: gapChips, transfers: preview.transfers.length, settle_mode: mode, food_fee: foodFeeOf(night), host: night.host_member_id ?? null });
    // remember the choice for next time
    await sb.from("poker_tables").update({ last_settings: { ...(table.last_settings ?? {}), settle_mode: mode } }).eq("id", table.id);
    // photos are only kept until the night is closed and balanced
    const { data: files } = await sb.storage.from("chip-photos").list(night.id, { limit: 1000 });
    if (files?.length) await sb.storage.from("chip-photos").remove(files.map((f) => `${night.id}/${f.name}`));
    ok(await sb.from("game_nights").update({ status: "closed", closed_at: new Date().toISOString(), photos_purged: true, settle_mode: mode }).eq("id", night.id));
  }

  async function saveFood(fee: number, hostId: string | null) {
    const { error } = await supabase().from("game_nights").update({ food_fee: fee, host_member_id: hostId }).eq("id", night.id);
    if (error) throw error;
    await logEvent(night.id, "food_fee_changed", { fee, host: hostId });
  }

  if (counting) {
    return (
      <Sheet open={open} onClose={() => setCounting(null)} title={`ספירה: ${nameOf(members, counting)}`}>
        <ChipCounter
          chipSet={chipSet}
          rate={rate}
          initial={counts[counting]?.total ?? null}
          cta="שמירת ספירה"
          onDone={({ total, photo }) => {
            setCounts((c) => ({ ...c, [counting]: { total, photo } }));
            setCounting(null);
          }}
        />
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="סגירת ערב">
      <div className="space-y-4">
        {flaggedCount > 0 && (
          <div className="flex items-center gap-2 rounded-2xl border border-warn/40 bg-warn/10 p-3 text-sm font-bold text-warn">
            <AlertTriangle className="size-4 shrink-0" /> יש {flaggedCount} מסירות שממתינות להחלטה שלך בקופה. הצ'יפים כבר על השולחן, אז קודם מחליטים עליהן ואז סוגרים.
          </div>
        )}
        {pendingCount - flaggedCount > 0 && (
          <div className="flex items-center gap-2 rounded-2xl bg-warn/10 p-3 text-sm text-warn">
            <AlertTriangle className="size-4" /> יש {pendingCount - flaggedCount} בקשות פתוחות בקופה. הן לא ייספרו.
          </div>
        )}
        <p className="text-sm text-muted">ספרו את הצ'יפים של כל מי שעדיין משחק. אפשר לצלם, לרשום צ'יפים או סכום במזומן. טעיתם? לוחצים שוב ומתקנים.</p>
        {noShows.length > 0 && (
          <p className="text-xs text-muted">לא הגיעו ולא קנו: {noShows.map((p) => nameOf(members, p.member_id)).join(", ")}. הם יורדו מהערב בסגירה.</p>
        )}
        <div className="space-y-2">
          {playing.map((p) => {
            const c = counts[p.member_id];
            const l = lines.find((x) => x.member_id === p.member_id)!;
            return (
              <button key={p.id} onClick={() => setCounting(p.member_id)} className="flex w-full items-center gap-3 rounded-2xl bg-surface-2 p-3 text-right">
                <Avatar name={nameOf(members, p.member_id)} src={members.find((m) => m.id === p.member_id)?.avatar_url} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{nameOf(members, p.member_id)}</div>
                  <div className="num text-xs text-muted">קנה {l.boughtChips.toLocaleString()}</div>
                </div>
                {c ? (
                  <div className="text-left">
                    <div className="num font-extrabold">{c.total.toLocaleString()}</div>
                    <div className={`num text-xs ${chipsToMoney(c.total, rate) - l.boughtMoney >= 0 ? "text-win" : "text-loss"}`}>
                      {formatSigned(chipsToMoney(c.total, rate) - l.boughtMoney)}
                    </div>
                  </div>
                ) : (
                  <Badge tone="gold">
                    <Camera className="size-3" /> לספור
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {out.length > 0 && (
          <div className="space-y-1">
            <h3 className="px-1 text-xs font-bold text-muted">קמו מהשולחן (לחיצה לתיקון ספירה)</h3>
            {out.map((p) => (
              <button key={p.id} onClick={() => onPlayer?.(p.member_id)} className="flex w-full items-center gap-3 rounded-2xl bg-surface-2/60 px-3 py-2 text-right">
                <Avatar name={nameOf(members, p.member_id)} src={members.find((m) => m.id === p.member_id)?.avatar_url} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{nameOf(members, p.member_id)}</span>
                <span className="num text-xs text-muted">{Number(p.final_chips ?? 0).toLocaleString()}</span>
                <span className={`num text-xs font-bold ${Number(p.net ?? 0) >= 0 ? "text-win" : "text-loss"}`}>{formatSigned(Number(p.net ?? 0))}</span>
                <Pencil className="size-3.5 text-muted" />
              </button>
            ))}
          </div>
        )}

        <FoodFeeEditor fee={foodFeeOf(night)} hostId={night.host_member_id ?? null} members={members} onSave={saveFood} />

        {allCounted && preview && (
          <>
            <Card className={`p-3 text-sm ${gapChips === 0 ? "border-win/40" : "border-warn/40"}`}>
              <div className="flex justify-between">
                <span className="text-muted">חולקו</span>
                <span className="num font-bold">{handed.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">נספרו</span>
                <span className="num font-bold">{counted.toLocaleString()}</span>
              </div>
              {gapChips === 0 ? (
                <div className="mt-2 flex items-center gap-1 font-bold text-win">
                  <Check className="size-4" /> הכל מאוזן, אין חוסרים
                </div>
              ) : (
                <div className="mt-2 text-warn">
                  {gapChips > 0 ? "עודף" : "חוסר"} של {Math.abs(gapChips).toLocaleString()} צ'יפים ({formatMoney(Math.abs(chipsToMoney(gapChips, rate)))}). אפשר לספור שוב, או לסגור והפער יתחלק יחסית לערימות.
                </div>
              )}
            </Card>
            {handoverGaps.length > 0 && (
              <div className="space-y-1 rounded-2xl bg-surface-2 p-3 text-xs text-muted">
                {handoverGaps.map((h) => (
                  <div key={h.id}>
                    בהחלפת קופאי ({h.from_member ? nameOf(members, h.from_member) : "—"} ← {nameOf(members, h.to_member)}) נמצא{" "}
                    {Number(h.gap_chips) > 0 ? "עודף" : "חוסר"} של {Math.abs(Number(h.gap_chips)).toLocaleString()} צ'יפים
                    {h.note ? ` · ${h.note}` : ""}
                  </div>
                ))}
              </div>
            )}
            {cashierId && (
              <div className="grid grid-cols-2 rounded-2xl bg-surface-2 p-1">
                {([
                  ["players", "חלוקה אוטומטית", "מינימום העברות בין השחקנים"],
                  ["cashier", "הכל דרך הקופאי", `כולם מתחשבנים מול ${nameOf(members, cashierId)}`],
                ] as const).map(([m, label, sub]) => (
                  <button key={m} onClick={() => setMode(m)} className={`rounded-xl px-2 py-2 text-center ${mode === m ? "bg-gold text-[#1d1405]" : "text-muted"}`}>
                    <div className="text-sm font-bold">{label}</div>
                    <div className={`text-[10px] ${mode === m ? "text-[#1d1405]/70" : "text-muted"}`}>{sub}</div>
                  </button>
                ))}
              </div>
            )}
            {foodPayers > 0 && night.host_member_id && (
              <p className="rounded-2xl bg-surface-2 p-3 text-xs text-muted">
                🍽️ דמי אוכל: {foodPayers} × {formatMoney(foodFeeOf(night))} = {formatMoney(food[night.host_member_id])} ל{nameOf(members, night.host_member_id)}. כלול בהעברות למטה, לא בתוצאות המשחק.
              </p>
            )}
            <Transfers transfers={preview.transfers} members={members} />
            <Button size="lg" className="w-full" loading={busy} disabled={flaggedCount > 0} onClick={finish}>
              <Check className="size-5" /> סגירה סופית
            </Button>
            {err && <p className="text-sm text-loss">{err}</p>}
            <p className="text-center text-xs text-muted">בסגירה התמונות של הערב נמחקות והחובות נשמרים.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

function Transfers({ transfers, members }: { transfers: { from: string; to: string; amount: number }[]; members: Member[] }) {
  if (!transfers.length) return <div className="text-center text-sm text-muted">אף אחד לא חייב לאף אחד 🤝</div>;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-muted">מי מעביר למי ({transfers.length} העברות)</h3>
      {transfers.map((t, i) => (
        <div key={i} className="flex items-center gap-2 rounded-2xl bg-surface-2 p-3 text-sm">
          <span className="font-bold">{nameOf(members, t.from)}</span>
          <span className="text-muted">←</span>
          <span className="flex-1 font-bold">{nameOf(members, t.to)}</span>
          <span className="num font-extrabold text-gold">{formatMoney(t.amount)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Closed night summary
// ---------------------------------------------------------------------------
export function Summary({
  night, players, lines, settlements: allSettlements, members, meId, isAdmin, reload, seeAll = true, requests = [], table = null, onPlayer,
}: {
  night: GameNight; players: NightPlayer[]; lines: PlayerLine[]; settlements: Settlement[]; members: Member[]; meId: string; isAdmin: boolean; reload: () => void; seeAll?: boolean;
  requests?: ChipRequest[]; table?: PokerTable | null;
  /** open a player (the admin fixes a count or a purchase there) */
  onPlayer?: (memberId: string) => void;
}) {
  const food = nightFood(night, players);
  const fee = foodFeeOf(night);
  const foodLine = (id: string) =>
    !food[id] ? "" : id === night.host_member_id ? ` · 🍽️ מארח ${formatSigned(food[id])}` : ` · 🍽️ ${formatSigned(food[id])}`;
  async function saveFood(f: number, hostId: string | null) {
    await recalcClosedNight({ night, players, requests, settlements: allSettlements, table, foodFee: f, hostId });
    await logEvent(night.id, "food_fee_changed", { fee: f, host: hostId, after_close: true });
    reload();
  }
  const allRanked = [...players].sort((a, b) => Number(b.net ?? 0) - Number(a.net ?? 0));
  // when the table hides others' results, a player sees only their own line and transfers
  const ranked = seeAll ? allRanked : allRanked.filter((p) => p.member_id === meId);
  const settlements = seeAll ? allSettlements : allSettlements.filter((s) => s.from_member === meId || s.to_member === meId);
  const date = new Date(night.started_at).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" });

  const shareText = [
    night.name ? `🃏 סיכום ${night.name} · ${date}` : `🃏 סיכום ערב פוקר ${date}`,
    "",
    ...ranked.map((p, i) => `${i === 0 ? "🏆" : "•"} ${nameOf(members, p.member_id)}: ${formatSigned(Number(p.net ?? 0))}`),
    ...(fee > 0 && night.host_member_id && Object.keys(food).length
      ? ["", `🍽️ דמי אוכל ${formatMoney(fee)} לשחקן, למארח ${nameOf(members, night.host_member_id)} (כלול בהעברות)`]
      : []),
    "",
    settlements.length ? "💸 מי מעביר למי:" : "אין העברות 🤝",
    ...settlements.map((s) => `${nameOf(members, s.from_member)} ← ${nameOf(members, s.to_member)}: ${formatMoney(Number(s.amount))}${s.paid ? " ✅" : ""}`),
  ].join("\n");

  async function markPaid(s: Settlement, paid: boolean) {
    await supabase().from("settlements").update({ paid, paid_at: paid ? new Date().toISOString() : null }).eq("id", s.id);
    reload();
  }

  return (
    <div className="space-y-4">
      {seeAll && (
        <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer" className="block">
          <Button size="lg" className="w-full">
            <Share2 className="size-5" /> שיתוף הסיכום לוואטסאפ
          </Button>
        </a>
      )}

      <Card className="p-0">
        <div className="divide-y divide-line">
          {ranked.map((p, i) => {
            const l = lines.find((x) => x.member_id === p.member_id);
            const net = Number(p.net ?? 0);
            return (
              <button key={p.id} type="button" onClick={() => onPlayer?.(p.member_id)} className={`flex w-full items-center gap-3 px-4 py-3 text-right ${p.member_id === meId ? "bg-gold/5" : ""}`}>
                <span className={`num w-5 text-center font-extrabold ${i === 0 ? "text-gold" : "text-muted"}`}>{i + 1}</span>
                <Avatar name={nameOf(members, p.member_id)} src={members.find((m) => m.id === p.member_id)?.avatar_url} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{nameOf(members, p.member_id)}</div>
                  <div className="num text-[11px] text-muted">
                    קנה {formatMoney(Number(p.bought_money ?? l?.boughtMoney ?? 0))} · סיים עם {Number(p.final_chips ?? 0).toLocaleString()}{foodLine(p.member_id)}
                  </div>
                </div>
                <div className={`num font-extrabold ${net >= 0 ? "text-win" : "text-loss"}`}>{formatSigned(net)}</div>
              </button>
            );
          })}
        </div>
      </Card>

      {isAdmin && (
        <Card className="space-y-3 p-3">
          <p className="text-xs text-muted">
            <Pencil className="inline size-3" /> טעות בספירה או בקנייה? לוחצים על שחקן ומתקנים. התוצאות וההעברות מחושבות מחדש, והתיקון נרשם ביומן.
          </p>
          <FoodFeeEditor compact fee={fee} hostId={night.host_member_id ?? null} members={members} onSave={saveFood} />
        </Card>
      )}
      {!isAdmin && fee > 0 && night.host_member_id && (
        <p className="px-1 text-xs text-muted">🍽️ דמי אוכל {formatMoney(fee)} לשחקן, למארח {nameOf(members, night.host_member_id)}. כלול בהעברות, לא בתוצאות.</p>
      )}

      <section className="space-y-2">
        <h3 className="px-1 text-sm font-bold text-muted">מי מעביר למי</h3>
        {settlements.length === 0 && <Card className="text-center text-sm text-muted">אין העברות 🤝</Card>}
        {settlements.map((s) => {
          const canMark = isAdmin || s.to_member === meId;
          return (
            <div key={s.id} className={`flex items-center gap-2 rounded-2xl border border-line bg-surface p-3 text-sm ${s.paid ? "opacity-60" : ""}`}>
              <span className="font-bold">{nameOf(members, s.from_member)}</span>
              <span className="text-muted">←</span>
              <span className="flex-1 font-bold">{nameOf(members, s.to_member)}</span>
              <span className="num font-extrabold text-gold">{formatMoney(Number(s.amount))}</span>
              {s.paid ? (
                <button disabled={!canMark} onClick={() => markPaid(s, false)}>
                  <Badge tone="win">
                    <Check className="size-3" /> שולם
                  </Badge>
                </button>
              ) : canMark ? (
                <Button size="sm" variant="soft" onClick={() => markPaid(s, true)}>
                  שולם
                </Button>
              ) : (
                <Badge tone="warn">פתוח</Badge>
              )}
            </div>
          );
        })}
      </section>
      {night.photos_purged && (
        <p className="flex items-center justify-center gap-1 text-xs text-muted">
          <Trash2 className="size-3" /> תמונות הערב נמחקו בסגירה
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------
const EVENT_TEXT: Record<string, (p: Record<string, unknown>, n: (id: unknown) => string) => string> = {
  night_opened: (p) => `הערב נפתח עם ${p.players} שחקנים`,
  request: (p, n) => `${n(p.member_id)} ביקש ${Number(p.chips).toLocaleString()} צ'יפים`,
  approved: (p, n) => `נמסרו ל${n(p.member_id)} ${Number(p.given).toLocaleString()} צ'יפים`,
  manual_correction: (p, n) => `תיקון ידני: ${n(p.member_id)} ביקש ${Number(p.requested).toLocaleString()}, נמסרו ${Number(p.given).toLocaleString()}`,
  flagged: (p, n) => `אי התאמה אצל ${n(p.member_id)}: ביקש ${Number(p.requested).toLocaleString()}, זוהו ${Number(p.detected).toLocaleString()}`,
  count_corrected: (p, n) => `נמסרו ל${n(p.member_id)} ${Number(p.given).toLocaleString()} צ'יפים (בתמונה זוהו ${Number(p.detected).toLocaleString()}, הקופאי תיקן את הספירה)`,
  admin_approved: (p, n) => `המנהל אישר את המסירה ל${n(p.member_id)} (${Number(p.given).toLocaleString()})`,
  admin_corrected: (p, n) => `המנהל תיקן את המסירה ל${n(p.member_id)} ל-${Number(p.given).toLocaleString()}`,
  rejected: (p, n) => `בקשה של ${n(p.member_id)} נדחתה`,
  cashout: (p, n) => `${n(p.member_id)} קם עם ${Number(p.chips).toLocaleString()} צ'יפים (${formatSigned(Number(p.net))})`,
  cashout_undone: (p, n) => `${n(p.member_id)} חזר לשחק`,
  cashier_changed: (p, n) => `${n(p.member_id)} הוא הקופאי עכשיו`,
  cashier_handover: (p, n) => {
    const gap = Number(p.gap);
    const check = gap === 0 ? "הספירה מאוזנת" : `${gap > 0 ? "עודף" : "חוסר"} של ${Math.abs(gap).toLocaleString()} צ'יפים`;
    const bank = p.bank != null ? ` · בקופה ${Number(p.bank).toLocaleString()}` : "";
    return `החלפת קופאי: ${p.from ? n(p.from) : "—"} ← ${n(p.to)}${p.left ? " (עזב את המשחק)" : ""} · ${check}${bank}`;
  },
  player_added: (p, n) => `${n(p.member_id)} הצטרף לערב`,
  player_removed: (p, n) => `${n(p.member_id)} הוסר מהערב`,
  night_closed: () => `הערב נסגר`,
  count_edited: (p, n) => `תיקון ספירה${p.after_close ? " אחרי הסגירה" : ""}: ${n(p.member_id)} ${Number(p.from).toLocaleString()} ← ${Number(p.to).toLocaleString()} צ'יפים`,
  purchase_edited: (p, n) => `תיקון קנייה${p.after_close ? " אחרי הסגירה" : ""}: ${n(p.member_id)} ${Number(p.from).toLocaleString()} ← ${Number(p.to).toLocaleString()} צ'יפים`,
  food_fee_changed: (p, n) => `דמי אוכל: ${formatMoney(Number(p.fee))} לשחקן${p.host ? `, מארח ${n(p.host)}` : ""}`,
  results_corrected: (p) => `תיקון תוצאות: ${String(p.reason ?? "")}`,
};

export function EventFeed({ events, members }: { events: NightEvent[]; members: Member[] }) {
  const n = (id: unknown) => nameOf(members, String(id));
  return (
    <div className="max-h-80 space-y-1 overflow-y-auto border-t border-line px-4 py-3">
      {events.length === 0 && <div className="text-center text-xs text-muted">אין עדיין פעולות</div>}
      {events.map((e) => (
        <div key={e.id} className="flex gap-2 text-xs">
          <span className="num shrink-0 text-muted">{new Date(e.created_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</span>
          <span>{EVENT_TEXT[e.kind]?.(e.payload, n) ?? e.kind}</span>
        </div>
      ))}
    </div>
  );
}
