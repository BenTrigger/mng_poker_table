"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, X, AlertTriangle, Pencil, Share2, Landmark, UserPlus, LogOut, ImageIcon, Sparkles, Trash2, ArrowLeftRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { logEvent } from "@/lib/hooks";
import { balanceNets, chipCheck, chipRate, chipsToMoney, formatMoney, formatSigned, moneyToChips, round2, settle, settleViaHub, type PlayerLine, type SettleMode } from "@/lib/calc";
import { breakdown, chipCountingEnabled, countChipsFromPhoto } from "@/lib/chips";
import { compressImage } from "@/lib/image";
import type { PokerTable, CashierHandover, ChipCount, ChipRequest, ChipSet, GameNight, Member, NightEvent, NightPlayer, Settlement } from "@/lib/types";
import { Avatar, Badge, Button, Card, ChipDot, Field, Sheet, inputCls } from "@/components/ui";

export const nameOf = (members: Member[], id: string) => members.find((m) => m.id === id)?.display_name ?? "שחקן";

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
  open, onClose, night, me, canManage, players, members, chipSet,
}: {
  open: boolean; onClose: () => void; night: GameNight; me: Member; canManage: boolean; players: NightPlayer[]; members: Member[]; chipSet: ChipSet | null;
}) {
  const rate = chipRate(night);
  const playing = players.filter((p) => p.status === "playing");
  const [mode, setMode] = useState<"chips" | "money">("chips");
  const [value, setValue] = useState<number>(Number(night.chips_per_buyin));
  const [forId, setForId] = useState(me.id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("chips");
      setValue(Number(night.chips_per_buyin));
      setForId(playing.some((p) => p.member_id === me.id) ? me.id : playing[0]?.member_id ?? me.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chips = mode === "chips" ? value : moneyToChips(value, rate);
  const money = mode === "chips" ? chipsToMoney(value, rate) : value;
  const quick = [0.5, 1, 2].map((k) => ({ k, chips: Math.round(Number(night.chips_per_buyin) * k) }));

  async function send() {
    setBusy(true);
    const { data } = await supabase()
      .from("chip_requests")
      .insert({ night_id: night.id, member_id: forId, requested_by: await myUid(), mode, chips })
      .select()
      .single();
    await logEvent(night.id, "request", { member_id: forId, chips, money, request_id: data?.id });
    setBusy(false);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="בקשת צ'יפים">
      <div className="space-y-4">
        {canManage && playing.length > 1 && (
          <Field label="עבור">
            <select className={inputCls} value={forId} onChange={(e) => setForId(e.target.value)}>
              {playing.map((p) => (
                <option key={p.member_id} value={p.member_id}>
                  {nameOf(members, p.member_id)}
                </option>
              ))}
            </select>
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
        <Button size="lg" className="w-full" disabled={chips <= 0} loading={busy} onClick={send}>
          שליחה לקופאי
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

// ---------------------------------------------------------------------------
// Chip counter: photo -> AI count (if configured) with manual override
// ---------------------------------------------------------------------------
export function ChipCounter({
  chipSet, expected, onDone, cta, busy, hint = "צלם את הערימה מהצד",
}: {
  chipSet: ChipSet | null; expected?: number; cta: string; busy?: boolean; hint?: string;
  onDone: (r: { total: number; photo: Blob | null; detected: number | null; count: ChipCount | null; manual: boolean }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [counting, setCounting] = useState(false);
  const [count, setCount] = useState<ChipCount | null>(null);
  const [manual, setManual] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    chipCountingEnabled().then(setAiOn);
  }, []);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr(null);
    setCount(null);
    const blob = await compressImage(f);
    setPhoto(blob);
    setPreview(URL.createObjectURL(blob));
    if (aiOn && chipSet) {
      setCounting(true);
      try {
        const c = await countChipsFromPhoto(blob, chipSet, expected);
        setCount(c);
        setManual(String(c.total));
      } catch (e) {
        setErr(`לא הצלחתי לספור: ${(e as Error).message}. אפשר להזין ידנית.`);
      } finally {
        setCounting(false);
      }
    }
  }

  const total = Number(manual) || 0;
  const edited = count != null && total !== count.total;

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
        <button onClick={() => fileRef.current?.click()} className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gold/40 bg-gold/5 text-gold">
          <Camera className="size-8" />
          <span className="text-sm font-bold">{hint}</span>
          {aiOn && <span className="flex items-center gap-1 text-[11px] text-muted"><Sparkles className="size-3" /> {chipSet?.chips.some((c) => c.images?.length) ? "אספור לפי תמונות הצ'יפים של הערכה" : "אספור לפי צבעים"}</span>}
        </button>
      )}

      {counting && <div className="flex items-center justify-center gap-2 py-2 text-sm text-gold"><Sparkles className="size-4 animate-pulse" /> סופר צ'יפים...</div>}
      {count && (
        <Card className="space-y-2 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold">זיהיתי בתמונה</span>
            <Badge tone={count.confidence === "high" ? "win" : count.confidence === "medium" ? "warn" : "loss"}>
              ביטחון {count.confidence === "high" ? "גבוה" : count.confidence === "medium" ? "בינוני" : "נמוך"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {count.counts.filter((c) => c.count > 0).map((c) => {
              const chip = chipSet?.chips.find((x) => x.color === c.color);
              return (
                <span key={c.color} className="num inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-bold">
                  <ChipDot hex={chip?.hex ?? "#888"} size={14} /> {c.count} × {chip?.value}
                </span>
              );
            })}
          </div>
          {count.notes && <p className="text-xs text-muted">{count.notes}</p>}
        </Card>
      )}
      {err && <p className="text-xs text-warn">{err}</p>}

      <Field label="סה״כ צ'יפים" hint={edited ? "שינית את הספירה. התיקון יתועד ביומן הערב." : undefined}>
        <input className={`${inputCls} text-center text-2xl font-extrabold`} inputMode="numeric" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={expected ? String(expected) : "0"} />
      </Field>

      <Button
        size="lg"
        className="w-full"
        disabled={!manual || counting}
        loading={busy}
        onClick={() => onDone({ total, photo, detected: count?.total ?? null, count, manual: !count || edited })}
      >
        {cta}
      </Button>
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
  const queue = requests.filter((r) => r.status === "pending" || r.status === "flagged");

  useEffect(() => {
    if (!open) {
      setActive(null);
      setStep("count");
      setResult(null);
    }
  }, [open]);

  async function approve(r: ChipRequest, given: number, extra: Partial<ChipRequest> = {}, kind = "approved") {
    await supabase()
      .from("chip_requests")
      .update({ status: "approved", given_chips: given, approved_by: await myUid(), approved_at: new Date().toISOString(), ...extra })
      .eq("id", r.id);
    await logEvent(night.id, kind, { request_id: r.id, member_id: r.member_id, requested: Number(r.chips), given, detected: extra.detected_chips ?? r.detected_chips });
  }

  async function onCounted({ total, photo, detected }: { total: number; photo: Blob | null; detected: number | null }) {
    if (!active) return;
    setBusy(true);
    const path = photo ? await uploadPhoto(night.id, `req-${active.id}`, photo).catch(() => null) : null;
    const requested = Number(active.chips);
    if (total === requested && (detected == null || detected === requested)) {
      await approve(active, total, { photo_path: path, detected_chips: detected });
      setBusy(false);
      setActive(null);
      return;
    }
    setResult({ total, path, detected });
    setStep("mismatch");
    setBusy(false);
  }

  async function resolveMismatch(choice: "actual" | "flag") {
    if (!active || !result) return;
    setBusy(true);
    if (choice === "actual") {
      // the cashier really handed a different amount: debt follows what was handed
      await approve(active, result.total, { photo_path: result.path, detected_chips: result.detected, note: "תיקון ידני של הקופאי" }, "manual_correction");
    } else {
      // cashier says the requested amount was handed and the count is wrong: admin decides
      await supabase()
        .from("chip_requests")
        .update({ status: "flagged", given_chips: Number(active.chips), detected_chips: result.detected ?? result.total, photo_path: result.path })
        .eq("id", active.id);
      await logEvent(night.id, "flagged", { request_id: active.id, member_id: active.member_id, requested: Number(active.chips), detected: result.detected ?? result.total });
    }
    setBusy(false);
    setActive(null);
    setStep("count");
  }

  async function reject(r: ChipRequest) {
    await supabase().from("chip_requests").update({ status: "rejected" }).eq("id", r.id);
    await logEvent(night.id, "rejected", { request_id: r.id, member_id: r.member_id });
  }

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
            <ChipCounter chipSet={chipSet} expected={requested} cta="מסרתי, אישור" busy={busy} onDone={onCounted} />
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
                      <Button size="sm" onClick={() => approve(r, Number(r.given_chips), {}, "admin_approved")}>
                        <Check className="size-4" /> תקין, {Number(r.given_chips).toLocaleString()}
                      </Button>
                      <Button size="sm" variant="soft" onClick={() => approve(r, Number(r.detected_chips), {}, "admin_corrected")}>
                        לפי התמונה, {Number(r.detected_chips).toLocaleString()}
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-muted">ממתין לאישור מנהל</div>
                  )}
                </>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => setActive(r)}>
                    <Camera className="size-4" /> מסירה וצילום
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
      <Button variant="ghost" className="mt-4 w-full" onClick={onHandover}>
        <ArrowLeftRight className="size-4" /> החלפת קופאי (ספירה והעברת הקופה)
      </Button>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// One player's details: purchases with photos, cash out
// ---------------------------------------------------------------------------
export function PlayerSheet({
  onClose, night, memberId, players, requests, members, lines, chipSet, canManage,
}: {
  onClose: () => void; night: GameNight; memberId: string; players: NightPlayer[]; requests: ChipRequest[]; members: Member[]; lines: PlayerLine[]; chipSet: ChipSet | null; canManage: boolean;
}) {
  const rate = chipRate(night);
  const p = players.find((x) => x.member_id === memberId);
  const l = lines.find((x) => x.member_id === memberId);
  const mine = requests.filter((r) => r.member_id === memberId && r.status !== "rejected");
  const [cashout, setCashout] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!p || !l) return null;
  const closed = night.status === "closed";

  async function doCashout({ total, photo, detected, manual }: { total: number; photo: Blob | null; detected: number | null; manual: boolean }) {
    setBusy(true);
    const path = photo ? await uploadPhoto(night.id, `out-${memberId}`, photo).catch(() => null) : null;
    const net = round2(chipsToMoney(total, rate) - l!.boughtMoney);
    await supabase()
      .from("night_players")
      .update({ status: "out", final_chips: total, final_photo_path: path, left_at: new Date().toISOString(), bought_money: l!.boughtMoney, net })
      .eq("id", p!.id);
    await logEvent(night.id, "cashout", { member_id: memberId, chips: total, detected, manual, net });
    setBusy(false);
    onClose();
  }

  async function undoCashout() {
    await supabase().from("night_players").update({ status: "playing", final_chips: null, left_at: null, net: null, bought_money: null }).eq("id", p!.id);
    await logEvent(night.id, "cashout_undone", { member_id: memberId });
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={nameOf(members, memberId)}>
      {cashout ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">ספירת הצ'יפים של {nameOf(members, memberId)} ביציאה מהשולחן. החוב שלו ייסגר לפי הספירה ולא יתווסף לו חוב בהמשך הערב.</p>
          <ChipCounter chipSet={chipSet} cta="סגירת החשבון שלו" busy={busy} onDone={doCashout} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="קנה" value={formatMoney(l.boughtMoney)} />
            <Stat label="צ'יפים" value={l.boughtChips.toLocaleString()} />
            <Stat label={p.status === "out" || closed ? "תוצאה" : "כניסות"} value={p.status === "out" || closed ? formatSigned(Number(p.net ?? l.net)) : `${+l.buyins.toFixed(1)}`} tone={p.status === "out" || closed ? (Number(p.net ?? l.net) >= 0 ? "win" : "loss") : undefined} />
          </div>
          <div className="space-y-2">
            {mine.length === 0 && <div className="py-4 text-center text-sm text-muted">עוד לא קנה צ'יפים</div>}
            {mine.map((r) => (
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
              </div>
            ))}
          </div>
          {p.final_photo_path && !night.photos_purged && (
            <div className="flex items-center gap-3 text-sm text-muted">
              <PhotoThumb path={p.final_photo_path} /> צילום ספירת הסיום ({Number(p.final_chips).toLocaleString()} צ'יפים)
            </div>
          )}
          {canManage && !closed && p.status === "playing" && (
            <Button variant="soft" className="w-full" onClick={() => setCashout(true)}>
              <LogOut className="size-4" /> קם מהשולחן: ספירה וסגירת חוב
            </Button>
          )}
          {canManage && !closed && p.status === "out" && (
            <Button variant="ghost" className="w-full" onClick={undoCashout}>
              חזר לשחק (ביטול יציאה)
            </Button>
          )}
        </div>
      )}
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
  open, onClose, night, players, members, requests = [], onHandover, onCashout,
}: {
  open: boolean; onClose: () => void; night: GameNight; players: NightPlayer[]; members: Member[]; requests?: ChipRequest[];
  onHandover: () => void; onCashout: (memberId: string) => void;
}) {
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
    const { error } = await supabase().from("night_players").insert({ night_id: night.id, member_id: memberId, seat: nextSeat() });
    if (error) throw error;
    await logEvent(night.id, "player_added", { member_id: memberId });
  }
  const addPlayer = (id: string) => run(`add:${id}`, () => seat(id));
  const addGuest = () =>
    run("guest", async () => {
      const name = guest.trim();
      if (!name) return;
      const { data, error } = await supabase().from("table_members").insert({ table_id: night.table_id, display_name: name }).select().single();
      if (error) throw error;
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
                      {bought(p.member_id) ? "יציאה ופדיון" : "הסרה"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
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
            <input className={`${inputCls} h-11`} placeholder="שחקן חדש (שם)" value={guest} onChange={(e) => setGuest(e.target.value)} />
            <Button size="md" variant="soft" loading={busy === "guest"} disabled={!guest.trim() || !!busy} onClick={addGuest}>
              <UserPlus className="size-4" /> הוספה
            </Button>
          </div>
          </>
          )}
        </section>
        {err && <p className="text-sm text-loss">{err}</p>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// End of night: count everyone, check the gap, settle and close
// ---------------------------------------------------------------------------
export function CloseSheet({
  open, onClose, night, players, lines, members, chipSet, pendingCount, handovers = [], table,
}: {
  open: boolean; onClose: () => void; night: GameNight; players: NightPlayer[]; lines: PlayerLine[]; members: Member[]; chipSet: ChipSet | null; pendingCount: number; handovers?: CashierHandover[]; table: PokerTable;
}) {
  const rate = chipRate(night);
  const cashierId = night.cashier_member_id;
  const [mode, setMode] = useState<SettleMode>(table.last_settings?.settle_mode === "cashier" && cashierId ? "cashier" : "players");
  const playing = players.filter((p) => p.status === "playing");
  const [counts, setCounts] = useState<Record<string, { total: number; photo: Blob | null }>>({});
  const [counting, setCounting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allCounted = playing.every((p) => counts[p.member_id] != null);
  const { handed, counted, gap: gapChips } = chipCheck(
    lines,
    players,
    Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, c.total])),
  );
  const handoverGaps = handovers.filter((h) => Number(h.gap_chips) !== 0);

  const preview = useMemo(() => {
    if (!allCounted) return null;
    const fixed = players.filter((p) => p.status === "out");
    const fixedTotal = fixed.reduce((s, p) => s + Number(p.net ?? 0), 0);
    const live = playing.map((p) => {
      const l = lines.find((x) => x.member_id === p.member_id)!;
      const fc = counts[p.member_id].total;
      return { id: p.member_id, net: round2(chipsToMoney(fc, rate) - l.boughtMoney), finalChips: fc };
    });
    const balanced = balanceNets(live, fixedTotal);
    const nets = [...balanced, ...fixed.map((p) => ({ id: p.member_id, net: Number(p.net ?? 0) }))];
    return { nets, transfers: mode === "cashier" && cashierId ? settleViaHub(nets, cashierId) : settle(nets) };
  }, [allCounted, players, playing, lines, counts, rate, mode, cashierId]);

  async function finish() {
    if (!preview) return;
    setBusy(true);
    const sb = supabase();
    for (const p of playing) {
      const c = counts[p.member_id];
      const l = lines.find((x) => x.member_id === p.member_id)!;
      const path = c.photo ? await uploadPhoto(night.id, `final-${p.member_id}`, c.photo).catch(() => null) : null;
      await sb
        .from("night_players")
        .update({ final_chips: c.total, final_photo_path: path, bought_money: l.boughtMoney, net: preview.nets.find((n) => n.id === p.member_id)!.net })
        .eq("id", p.id);
    }
    if (preview.transfers.length) {
      await sb.from("settlements").insert(preview.transfers.map((t) => ({ night_id: night.id, from_member: t.from, to_member: t.to, amount: t.amount })));
    }
    await logEvent(night.id, "night_closed", { gap_chips: gapChips, transfers: preview.transfers.length, settle_mode: mode });
    // remember the choice for next time
    await sb.from("poker_tables").update({ last_settings: { ...(table.last_settings ?? {}), settle_mode: mode } }).eq("id", table.id);
    // photos are only kept until the night is closed and balanced
    const { data: files } = await sb.storage.from("chip-photos").list(night.id, { limit: 1000 });
    if (files?.length) await sb.storage.from("chip-photos").remove(files.map((f) => `${night.id}/${f.name}`));
    await sb.from("game_nights").update({ status: "closed", closed_at: new Date().toISOString(), photos_purged: true }).eq("id", night.id);
    setBusy(false);
    onClose();
  }

  if (counting) {
    return (
      <Sheet open={open} onClose={() => setCounting(null)} title={`ספירה: ${nameOf(members, counting)}`}>
        <ChipCounter
          chipSet={chipSet}
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
        {pendingCount > 0 && (
          <div className="flex items-center gap-2 rounded-2xl bg-warn/10 p-3 text-sm text-warn">
            <AlertTriangle className="size-4" /> יש {pendingCount} בקשות פתוחות בקופה. הן לא ייספרו.
          </div>
        )}
        <p className="text-sm text-muted">ספרו את הצ'יפים של כל מי שעדיין משחק. אפשר לצלם וזה ייספר לפי צבעים.</p>
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
            <Transfers transfers={preview.transfers} members={members} />
            <Button size="lg" className="w-full" loading={busy} onClick={finish}>
              <Check className="size-5" /> סגירה סופית
            </Button>
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
  night, players, lines, settlements: allSettlements, members, meId, isAdmin, reload, seeAll = true,
}: {
  night: GameNight; players: NightPlayer[]; lines: PlayerLine[]; settlements: Settlement[]; members: Member[]; meId: string; isAdmin: boolean; reload: () => void; seeAll?: boolean;
}) {
  const allRanked = [...players].sort((a, b) => Number(b.net ?? 0) - Number(a.net ?? 0));
  // when the table hides others' results, a player sees only their own line and transfers
  const ranked = seeAll ? allRanked : allRanked.filter((p) => p.member_id === meId);
  const settlements = seeAll ? allSettlements : allSettlements.filter((s) => s.from_member === meId || s.to_member === meId);
  const date = new Date(night.started_at).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" });

  const shareText = [
    `🃏 סיכום ערב פוקר ${date}`,
    "",
    ...ranked.map((p, i) => `${i === 0 ? "🏆" : "•"} ${nameOf(members, p.member_id)}: ${formatSigned(Number(p.net ?? 0))}`),
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
              <div key={p.id} className={`flex items-center gap-3 px-4 py-3 ${p.member_id === meId ? "bg-gold/5" : ""}`}>
                <span className={`num w-5 text-center font-extrabold ${i === 0 ? "text-gold" : "text-muted"}`}>{i + 1}</span>
                <Avatar name={nameOf(members, p.member_id)} src={members.find((m) => m.id === p.member_id)?.avatar_url} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{nameOf(members, p.member_id)}</div>
                  <div className="num text-[11px] text-muted">
                    קנה {formatMoney(Number(p.bought_money ?? l?.boughtMoney ?? 0))} · סיים עם {Number(p.final_chips ?? 0).toLocaleString()}
                  </div>
                </div>
                <div className={`num font-extrabold ${net >= 0 ? "text-win" : "text-loss"}`}>{formatSigned(net)}</div>
              </div>
            );
          })}
        </div>
      </Card>

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
