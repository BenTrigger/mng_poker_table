"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, MapPin, Trophy, Users, Plus, Minus, Hourglass } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useTableTournaments, type TournamentRow } from "@/lib/tournament-hooks";
import { SPEEDS, blindStructure, type Speed, type TournamentForm } from "@/lib/tournament";
export type { TournamentForm };
import { signupDate, signupTime } from "@/lib/signup";
import { formatMoney } from "@/lib/calc";
import type { Tournament } from "@/lib/types";
import { Badge, Button, Card, Field, Sheet, inputCls } from "./ui";

/** Next Friday at 20:00 as a value for <input type="datetime-local"> */
function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  d.setHours(20, 0, 0, 0);
  return toLocalInput(d);
}
const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const T_STATUS = {
  registration: { label: "הרשמה", tone: "win" },
  running: { label: "משחקים עכשיו", tone: "gold" },
  finished: { label: "הסתיים", tone: "muted" },
  cancelled: { label: "בוטל", tone: "loss" },
} as const;

/** Tournaments on the table's Night tab: upcoming and running ones, and the admin's "new tournament" button */
export function TournamentsSection({ tableId, isAdmin, lastSettings }: { tableId: string; isAdmin: boolean; lastSettings?: Partial<TournamentForm> }) {
  const { rows } = useTableTournaments(tableId);
  const [open, setOpen] = useState(false);
  const live = rows.filter((t) => t.status === "registration" || t.status === "running");
  const done = rows.filter((t) => t.status === "finished").slice(0, 3);
  if (!rows.length && !isAdmin) return null;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-bold text-muted">טורנירים</h2>
        {isAdmin && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <Trophy className="size-4" /> טורניר חדש
          </Button>
        )}
      </div>
      {live.length === 0 && done.length === 0 ? (
        <Card className="text-center text-sm text-muted">
          רוצים טורניר? קובעים כניסה, ערימה ומספר שולחנות, משתפים בוואטסאפ, והאפליקציה מגרילה מקומות ומריצה את השעון.
        </Card>
      ) : (
        <div className="space-y-2">
          {[...live, ...done].map((t) => (
            <TournamentCard key={t.id} t={t} />
          ))}
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="טורניר חדש">
        <TournamentFormView tableId={tableId} initial={lastSettings} />
      </Sheet>
    </section>
  );
}

function TournamentCard({ t }: { t: TournamentRow }) {
  const cap = t.table_count * t.seats_per_table;
  const taken = t.entries.filter((e) => e.status !== "waiting").length;
  const waiting = t.entries.filter((e) => e.status === "waiting").length;
  const left = t.entries.filter((e) => e.status === "playing").length;
  const st = T_STATUS[t.status];
  return (
    <Link href={`/tr/${t.id}`} className="block">
      <Card className={`flex items-center gap-3 ${t.status === "running" ? "border-gold/50 bg-gold/5" : ""}`}>
        <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gold/10 text-gold">
          <Trophy className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{t.name}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>
              {signupDate(t.starts_at)} · <span className="num">{signupTime(t.starts_at)}</span>
            </span>
            <span className="num inline-flex items-center gap-1">
              <Users className="size-3.5" /> {t.status === "running" ? `${left}/${taken}` : `${taken}/${cap}`}
            </span>
            {t.status === "registration" && waiting > 0 && (
              <span className="inline-flex items-center gap-1">
                <Hourglass className="size-3.5" /> {waiting}
              </span>
            )}
            {t.location && (
              <span className="inline-flex min-w-0 items-center gap-1 truncate">
                <MapPin className="size-3.5" /> {t.location}
              </span>
            )}
          </div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
        <ChevronLeft className="size-5 text-muted" />
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------


export const DEFAULT_FORM: TournamentForm = {
  name: "טורניר",
  startsAt: "",
  location: "",
  address: "",
  note: "",
  tables: 1,
  seats: 9,
  buyIn: 100,
  stack: 10000,
  speed: "regular",
  rebuyLevels: 4,
  addon: false,
  lateReg: 4,
};

export function formFromTournament(t: Tournament): TournamentForm {
  const minutes = t.levels.find((l) => !l.break)?.minutes ?? 20;
  const speed = (Object.entries(SPEEDS).find(([, v]) => v.minutes === minutes)?.[0] ?? "regular") as Speed;
  return {
    name: t.name,
    startsAt: toLocalInput(new Date(t.starts_at)),
    location: t.location ?? "",
    address: t.address ?? "",
    note: t.note ?? "",
    tables: t.table_count,
    seats: t.seats_per_table,
    buyIn: Number(t.buy_in),
    stack: t.starting_stack,
    speed,
    rebuyLevels: t.rebuy_until_level,
    addon: t.addon_price != null,
    lateReg: t.late_reg_until_level,
  };
}

/** Database fields for a form */
export function tournamentFields(f: TournamentForm) {
  return {
    name: f.name.trim() || "טורניר",
    starts_at: new Date(f.startsAt).toISOString(),
    location: f.location.trim() || null,
    address: f.address.trim() || null,
    note: f.note.trim() || null,
    table_count: f.tables,
    seats_per_table: f.seats,
    buy_in: f.buyIn,
    starting_stack: f.stack,
    rebuy_until_level: f.rebuyLevels,
    rebuy_price: null,
    rebuy_chips: null,
    // add-on at the first break: same price as the buy-in for a full starting stack
    addon_price: f.addon ? f.buyIn : null,
    addon_chips: f.addon ? f.stack : null,
    late_reg_until_level: f.lateReg,
    levels: blindStructure(f.stack, SPEEDS[f.speed].minutes),
  };
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="soft" type="button" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="פחות">
        <Minus className="size-4" />
      </Button>
      <span className="num w-8 text-center text-xl font-extrabold">{value}</span>
      <Button size="sm" variant="soft" type="button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="יותר">
        <Plus className="size-4" />
      </Button>
    </div>
  );
}

function Pills<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded-2xl px-3.5 py-2 text-sm font-bold ${value === o.v ? "bg-gold text-[#1d1405]" : "bg-surface-2 text-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The tournament form. Without `existing` it creates a tournament and opens it;
 * with `existing` (before the start) it saves the changes.
 */
export function TournamentFormView({
  tableId, initial, existing, onSaved,
}: { tableId: string; initial?: Partial<TournamentForm>; existing?: Tournament; onSaved?: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<TournamentForm>(() =>
    existing ? formFromTournament(existing) : { ...DEFAULT_FORM, ...initial, startsAt: defaultStart(), location: "", address: "", note: "" },
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof TournamentForm>(k: K, v: TournamentForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const cap = f.tables * f.seats;
  const levels = blindStructure(f.stack, SPEEDS[f.speed].minutes).filter((l) => !l.break);

  async function save() {
    setBusy(true);
    setErr(null);
    const sb = supabase();
    const fields = tournamentFields(f);
    if (existing) {
      const { error } = await sb.from("tournaments").update(fields).eq("id", existing.id);
      if (!error && (f.tables !== existing.table_count || f.seats !== existing.seats_per_table)) {
        await sb.rpc("resize_tournament", { p_id: existing.id, p_tables: f.tables, p_seats: f.seats });
      }
      setBusy(false);
      if (error) return setErr(error.message);
      return onSaved?.();
    }
    const { data: u } = await sb.auth.getUser();
    const { data, error } = await sb
      .from("tournaments")
      .insert({ ...fields, table_id: tableId, created_by: u.user?.id })
      .select()
      .single();
    if (error || !data) {
      setBusy(false);
      return setErr(error?.message ?? "שגיאה");
    }
    // remember the format for next time (merged into the table's last settings)
    const { data: t } = await sb.from("poker_tables").select("last_settings").eq("id", tableId).single();
    const { name, tables, seats, buyIn, stack, speed, rebuyLevels, addon, lateReg } = f;
    await sb
      .from("poker_tables")
      .update({ last_settings: { ...(t?.last_settings ?? {}), tournament: { name, tables, seats, buyIn, stack, speed, rebuyLevels, addon, lateReg } } })
      .eq("id", tableId);
    router.push(`/tr/${data.id}`);
  }

  return (
    <div className="space-y-4">
      <Field label="שם">
        <input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="מתי">
        <input type="datetime-local" className={inputCls} value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
      </Field>

      <Card className="space-y-3 bg-surface-2/50 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold">שולחנות</span>
          <Stepper value={f.tables} min={1} max={10} onChange={(n) => set("tables", n)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold">כיסאות בשולחן</span>
          <Stepper value={f.seats} min={2} max={10} onChange={(n) => set("seats", n)} />
        </div>
        <p className="text-xs text-muted">
          עד <b className="num text-ink">{cap}</b> שחקנים. מי שנרשם אחרי שמתמלא נכנס לרשימת המתנה. בפתיחה האפליקציה מגרילה מקומות ומחלקת שווה בין השולחנות.
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Field label="כניסה (₪)">
          <input className={inputCls} inputMode="decimal" value={f.buyIn || ""} onChange={(e) => set("buyIn", Number(e.target.value) || 0)} />
        </Field>
        <Field label="צ'יפים בפתיחה">
          <input className={inputCls} inputMode="numeric" value={f.stack || ""} onChange={(e) => set("stack", Number(e.target.value) || 0)} />
        </Field>
      </div>

      <Field label="קצב עליית בליינדים">
        <Pills
          value={f.speed}
          options={(Object.keys(SPEEDS) as Speed[]).map((s) => ({ v: s, label: `${SPEEDS[s].label} · ${SPEEDS[s].minutes} דק'` }))}
          onChange={(v) => set("speed", v)}
        />
      </Field>
      {f.stack > 0 && (
        <p className="num -mt-2 text-xs text-muted">
          בליינדים: {levels.slice(0, 5).map((l) => `${l.sb}/${l.bb}`).join(" · ")} … הפסקה אחרי שלב 4 ו-8.
        </p>
      )}

      <Field label="ריביי (קנייה חוזרת למי שנגמרו לו הצ'יפים)">
        <Pills
          value={f.rebuyLevels}
          options={[
            { v: 0, label: "בלי" },
            { v: 2, label: "עד שלב 2" },
            { v: 4, label: "עד שלב 4" },
            { v: 6, label: "עד שלב 6" },
          ]}
          onChange={(v) => set("rebuyLevels", v)}
        />
      </Field>
      <Field label="הרשמה מאוחרת">
        <Pills
          value={f.lateReg}
          options={[
            { v: 0, label: "בלי" },
            { v: 2, label: "עד שלב 2" },
            { v: 4, label: "עד שלב 4" },
            { v: 6, label: "עד שלב 6" },
          ]}
          onChange={(v) => set("lateReg", v)}
        />
      </Field>
      <label className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 p-3">
        <span>
          <span className="block font-bold">אד-און בהפסקה הראשונה</span>
          <span className="text-xs text-muted">
            עוד {Number(f.stack).toLocaleString()} צ'יפים ב-{formatMoney(f.buyIn)}, פעם אחת לשחקן
          </span>
        </span>
        <input type="checkbox" className="size-5 accent-[var(--color-gold)]" checked={f.addon} onChange={(e) => set("addon", e.target.checked)} />
      </label>

      <Field label="מארח (לא חובה)">
        <input className={inputCls} placeholder="אצל יוסי" value={f.location} onChange={(e) => set("location", e.target.value)} />
      </Field>
      <Field label="כתובת (לא חובה)" hint="החברים יוכלו לנווט אליה בוויז בלחיצה.">
        <input className={inputCls} placeholder="הרצל 10, תל אביב" value={f.address} onChange={(e) => set("address", e.target.value)} />
      </Field>
      <Field label="הערה (לא חובה)">
        <input className={inputCls} placeholder="מגיעים חצי שעה לפני" value={f.note} onChange={(e) => set("note", e.target.value)} />
      </Field>
      {err && <p className="text-sm text-loss">{err}</p>}
      <Button className="w-full" size="lg" disabled={!f.startsAt || f.stack <= 0} loading={busy} onClick={save}>
        <Trophy className="size-5" /> {existing ? "שמירה" : "פתיחת הרשמה לטורניר"}
      </Button>
    </div>
  );
}
