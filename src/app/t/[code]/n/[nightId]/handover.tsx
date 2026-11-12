"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Camera, Check, Landmark, LogOut, Rows3, Vault } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { chipCheck, chipRate, chipsToMoney, formatMoney, formatSigned, round2, type PlayerLine } from "@/lib/calc";
import type { CashierHandover, ChipSet, GameNight, HandoverCount, Member, NightPlayer } from "@/lib/types";
import { Avatar, Badge, Button, Card, ChipDot, Field, Sheet, inputCls } from "@/components/ui";
import { ChipCounter, nameOf, uploadPhoto } from "./sheets";

type Counted = { total: number; photo: Blob | null; detected: number | null };
const BANK = "__bank__";

// ---------------------------------------------------------------------------
// Mid-night cashier handover: pick the new cashier, count every stack
// (photo of the stacks lined up in a row, summed by colour with the night's
// chip set), check against what was handed out, optionally count the bank,
// cash out the outgoing cashier if they leave, and pass the role on.
// ---------------------------------------------------------------------------
export function HandoverSheet({
  open, onClose, night, players, lines, members, chipSet, handovers,
}: {
  open: boolean; onClose: () => void; night: GameNight; players: NightPlayer[]; lines: PlayerLine[]; members: Member[]; chipSet: ChipSet | null; handovers: CashierHandover[];
}) {
  const rate = chipRate(night);
  const fromId = night.cashier_member_id;
  const fromPlayer = players.find((p) => p.member_id === fromId && p.status === "playing") ?? null;
  const candidates = players.filter((p) => p.status === "playing" && p.member_id !== fromId);

  const [step, setStep] = useState<"who" | "count">("who");
  const [toId, setToId] = useState<string | null>(null);
  const [leaves, setLeaves] = useState(true);
  const [counts, setCounts] = useState<Record<string, Counted>>({});
  const [counting, setCounting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep("who");
      setToId(null);
      setLeaves(true);
      setCounts({});
      setCounting(null);
      setNote("");
      setErr(null);
    }
  }, [open]);

  const playing = players.filter((p) => p.status === "playing");
  const live = Object.fromEntries(Object.entries(counts).filter(([id]) => id !== BANK).map(([id, c]) => [id, c.total]));
  const allCounted = playing.every((p) => counts[p.member_id] != null);
  const check = chipCheck(lines, players, live);
  const bank = counts[BANK] ?? null;
  const lastBank = [...handovers].reverse().find((h) => h.bank_chips != null) ?? null;

  const outgoing = useMemo(() => {
    if (!fromPlayer || !leaves) return null;
    const c = counts[fromPlayer.member_id];
    const l = lines.find((x) => x.member_id === fromPlayer.member_id);
    if (!c || !l) return null;
    return { chips: c.total, bought: l.boughtMoney, net: round2(chipsToMoney(c.total, rate) - l.boughtMoney) };
  }, [fromPlayer, leaves, counts, lines, rate]);

  async function confirm() {
    if (!toId) return;
    setBusy(true);
    setErr(null);
    try {
      const up = async (id: string, c: Counted) =>
        c.photo ? await uploadPhoto(night.id, `handover-${id === BANK ? "bank" : id}`, c.photo).catch(() => null) : null;
      const rows: HandoverCount[] = [];
      for (const p of playing) {
        const c = counts[p.member_id];
        rows.push({ member_id: p.member_id, chips: c.total, detected: c.detected, photo_path: await up(p.member_id, c) });
      }
      const bankPath = bank ? await up(BANK, bank) : null;
      const outRow = fromPlayer ? rows.find((r) => r.member_id === fromPlayer.member_id) : null;
      const { error } = await supabase().rpc("handover_cashier", {
        p_night: night.id,
        p_to: toId,
        p_handed: check.handed,
        p_counted: check.counted,
        p_counts: rows,
        p_bank: bank?.total ?? null,
        p_bank_photo: bankPath,
        p_cashout: outgoing
          ? { final_chips: outgoing.chips, photo_path: outRow?.photo_path ?? null, bought_money: outgoing.bought, net: outgoing.net }
          : null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      onClose();
    } catch (e) {
      setErr(`ההחלפה נכשלה: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (counting) {
    const isBank = counting === BANK;
    return (
      <Sheet open={open} onClose={() => setCounting(null)} title={isBank ? "ספירת הקופה" : `ספירה: ${nameOf(members, counting)}`}>
        <ChipCounter
          chipSet={chipSet}
          cta="שמירת ספירה"
          hint={isBank ? "סדר את הצ'יפים שבקופה בשורה וצלם מהצד" : "סדר את הערימות בשורה וצלם מהצד"}
          onDone={({ total, photo, detected }) => {
            setCounts((c) => ({ ...c, [counting]: { total, photo, detected } }));
            setCounting(null);
          }}
        />
      </Sheet>
    );
  }

  if (step === "who") {
    return (
      <Sheet open={open} onClose={onClose} title="החלפת קופאי">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {fromId ? `${nameOf(members, fromId)} מעביר את הקופה.` : "אין קופאי כרגע."} סופרים את כל הערימות על השולחן, מוודאים שאין חוסרים, ומעבירים את התפקיד.
          </p>
          <div>
            <div className="mb-1.5 text-sm font-medium text-muted">מי הקופאי החדש?</div>
            <div className="flex flex-wrap gap-2">
              {candidates.map((p) => (
                <button
                  key={p.member_id}
                  onClick={() => setToId(p.member_id)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${toId === p.member_id ? "bg-gold text-[#1d1405]" : "bg-surface-2"}`}
                >
                  <Landmark className="size-3.5" /> {nameOf(members, p.member_id)}
                </button>
              ))}
              {candidates.length === 0 && <span className="text-sm text-muted">אין שחקנים פעילים אחרים בערב</span>}
            </div>
          </div>
          {fromPlayer && (
            <label className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3 text-sm">
              <input type="checkbox" className="size-5 accent-[var(--color-gold)]" checked={leaves} onChange={(e) => setLeaves(e.target.checked)} />
              <span className="flex-1">
                <span className="font-bold">{nameOf(members, fromPlayer.member_id)} גם עוזב את המשחק</span>
                <span className="block text-xs text-muted">החשבון שלו ייסגר לפי הספירה, בדיוק כמו קימה מהשולחן</span>
              </span>
              <LogOut className="size-4 text-muted" />
            </label>
          )}
          <Button size="lg" className="w-full" disabled={!toId} onClick={() => setStep("count")}>
            המשך לספירה
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={`העברת הקופה ל${toId ? nameOf(members, toId) : ""}`}>
      <div className="space-y-4">
        <Card className="space-y-2 p-3 text-sm">
          <div className="flex items-center gap-2 font-bold">
            <Rows3 className="size-4 text-gold" /> כל שחקן מסדר את הערימה שלו בשורה, צבע ליד צבע
          </div>
          <p className="text-xs text-muted">מצלמים מהצד והאפליקציה סוכמת לפי הצבעים{chipSet ? ` של ערכת "${chipSet.name}"` : ""}. אפשר גם להקליד ידנית.</p>
          {chipSet && (
            <div className="flex flex-wrap gap-1.5">
              {chipSet.chips.map((c) => (
                <span key={c.color} className="num inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold">
                  <ChipDot hex={c.hex} size={12} /> {c.value}
                </span>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-2">
          {playing.map((p) => {
            const c = counts[p.member_id];
            const l = lines.find((x) => x.member_id === p.member_id);
            const isOutgoing = p.member_id === fromId;
            return (
              <button key={p.id} onClick={() => setCounting(p.member_id)} className="flex w-full items-center gap-3 rounded-2xl bg-surface-2 p-3 text-right">
                <Avatar name={nameOf(members, p.member_id)} src={members.find((m) => m.id === p.member_id)?.avatar_url} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    {nameOf(members, p.member_id)}
                    {isOutgoing && <Landmark className="size-3.5 text-gold" />}
                    {isOutgoing && leaves && <Badge>עוזב</Badge>}
                  </div>
                  <div className="num text-xs text-muted">קנה {(l?.boughtChips ?? 0).toLocaleString()}</div>
                </div>
                {c ? (
                  <div className="num text-left font-extrabold">{c.total.toLocaleString()}</div>
                ) : (
                  <Badge tone="gold">
                    <Camera className="size-3" /> לספור
                  </Badge>
                )}
              </button>
            );
          })}

          <button onClick={() => setCounting(BANK)} className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line p-3 text-right">
            <span className="grid size-9 place-items-center rounded-full bg-gold/10 text-gold">
              <Vault className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-bold">הקופה עצמה (רשות)</div>
              <div className="text-xs text-muted">
                {lastBank ? `בהחלפה הקודמת היו בקופה ${Number(lastBank.bank_chips).toLocaleString()}` : "הצ'יפים שעוד לא חולקו, לתיעוד מה עבר לקופאי החדש"}
              </div>
            </div>
            {bank ? <div className="num font-extrabold">{bank.total.toLocaleString()}</div> : <Badge>לספור</Badge>}
          </button>
        </div>

        {allCounted && (
          <>
            <Card className={`space-y-1 p-3 text-sm ${check.gap === 0 ? "border-win/40" : "border-warn/40"}`}>
              <div className="flex justify-between">
                <span className="text-muted">חולקו עד עכשיו</span>
                <span className="num font-bold">{check.handed.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">נספרו (כולל מי שכבר קם)</span>
                <span className="num font-bold">{check.counted.toLocaleString()}</span>
              </div>
              {check.gap === 0 ? (
                <div className="flex items-center gap-1 pt-1 font-bold text-win">
                  <Check className="size-4" /> הכל מאוזן, אפשר להעביר
                </div>
              ) : (
                <div className="pt-1 text-warn">
                  {check.gap > 0 ? "עודף" : "חוסר"} של {Math.abs(check.gap).toLocaleString()} צ'יפים ({formatMoney(Math.abs(chipsToMoney(check.gap, rate)))}). כדאי לספור שוב. אם ממשיכים, הפער יתועד ויוצג בסגירת הערב.
                </div>
              )}
            </Card>

            {outgoing && fromId && (
              <Card className="flex items-center justify-between p-3 text-sm">
                <span>
                  {nameOf(members, fromId)} יוצא עם <span className="num font-bold">{outgoing.chips.toLocaleString()}</span> צ'יפים
                </span>
                <span className={`num font-extrabold ${outgoing.net >= 0 ? "text-win" : "text-loss"}`}>{formatSigned(outgoing.net)}</span>
              </Card>
            )}

            <Field label="הערה (רשות)" hint={check.gap !== 0 ? "למשל: מה כנראה קרה עם הפער" : undefined}>
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>

            {err && <p className="text-xs text-loss">{err}</p>}
            <Button size="lg" className="w-full" loading={busy} onClick={confirm}>
              <ArrowLeftRight className="size-5" /> העברת הקופה ל{toId ? nameOf(members, toId) : ""}
            </Button>
          </>
        )}
        <Button variant="ghost" className="w-full" onClick={() => setStep("who")}>
          חזרה
        </Button>
      </div>
    </Sheet>
  );
}
