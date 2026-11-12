"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, ChevronLeft, Hourglass, MapPin, Armchair } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { signupDate, signupTime, useTableSignups } from "@/lib/signup";
import { Badge, Button, Card, Field, Sheet, inputCls } from "./ui";

/** Next Thursday at 21:00 as a value for <input type="datetime-local"> */
function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7));
  d.setHours(21, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Upcoming early sign-ups on the table's Night tab, and the admin's "open sign-up" button */
export function UpcomingSignups({ tableId, isAdmin }: { tableId: string; isAdmin: boolean }) {
  const router = useRouter();
  const { rows } = useTableSignups(tableId);
  const [open, setOpen] = useState(false);
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [seats, setSeats] = useState(9);
  const [place, setPlace] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    const sb = supabase();
    const { data: u } = await sb.auth.getUser();
    const { data, error } = await sb
      .from("signups")
      .insert({
        table_id: tableId,
        starts_at: new Date(startsAt).toISOString(),
        seats,
        location: place.trim() || null,
        address: address.trim() || null,
        note: note.trim() || null,
        created_by: u.user?.id,
      })
      .select()
      .single();
    setBusy(false);
    if (error || !data) return setErr(error?.message ?? "שגיאה");
    router.push(`/s/${data.id}`);
  }

  if (!rows.length && !isAdmin) return null;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-bold text-muted">ערבים קרובים</h2>
        {isAdmin && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <CalendarPlus className="size-4" /> הרשמה מוקדמת
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <Card className="text-center text-sm text-muted">
          קובעים ערב? פתח הרשמה מוקדמת, שתף בוואטסאפ, וכל אחד תופס כיסא בשולחן עד שמתמלא.
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => {
            const free = s.seats - s.taken;
            return (
              <Link key={s.id} href={`/s/${s.id}`} className="block">
                <Card className="flex items-center gap-3">
                  <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gold/10 text-center leading-none text-gold">
                    <div>
                      <div className="num text-lg font-extrabold">{new Date(s.starts_at).getDate()}</div>
                      <div className="text-[10px]">{new Date(s.starts_at).toLocaleDateString("he-IL", { month: "short" })}</div>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">
                      {signupDate(s.starts_at)} · <span className="num">{signupTime(s.starts_at)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span className="num inline-flex items-center gap-1">
                        <Armchair className="size-3.5" /> {s.taken}/{s.seats}
                      </span>
                      {s.waiting > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Hourglass className="size-3.5" /> {s.waiting} ממתינים
                        </span>
                      )}
                      {s.location && (
                        <span className="inline-flex min-w-0 items-center gap-1 truncate">
                          <MapPin className="size-3.5" /> {s.location}
                        </span>
                      )}
                    </div>
                  </div>
                  {s.mine ? (
                    <Badge tone="gold">רשום</Badge>
                  ) : s.status === "closed" ? (
                    <Badge tone="warn">סגור</Badge>
                  ) : free > 0 ? (
                    <Badge tone="win">{free} פנויים</Badge>
                  ) : (
                    <Badge>מלא</Badge>
                  )}
                  <ChevronLeft className="size-5 text-muted" />
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="הרשמה מוקדמת לערב">
        <div className="space-y-4">
          <Field label="מתי">
            <input type="datetime-local" className={inputCls} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field group label="כמה מקומות בשולחן" hint="מי שנרשם אחרי שהשולחן מלא נכנס לרשימת המתנה ועולה אוטומטית כשמתפנה מקום.">
            <div className="flex flex-wrap gap-2">
              {[4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSeats(n)}
                  className={`num grid size-11 place-items-center rounded-2xl text-base font-extrabold ${seats === n ? "bg-gold text-[#1d1405]" : "bg-surface-2 text-muted"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Field label="מארח (לא חובה)">
            <input className={inputCls} placeholder="אצל יוסי" value={place} onChange={(e) => setPlace(e.target.value)} />
          </Field>
          <Field label="כתובת (לא חובה)" hint="החברים יוכלו לנווט אליה בוויז בלחיצה.">
            <input className={inputCls} placeholder="הרצל 10, תל אביב" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="הערה (לא חובה)">
            <input className={inputCls} placeholder="כניסה 100 ₪, מביאים בירות" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {err && <p className="text-sm text-loss">{err}</p>}
          <Button className="w-full" size="lg" disabled={!startsAt} loading={busy} onClick={create}>
            <CalendarPlus className="size-5" /> פתיחת הרשמה
          </Button>
        </div>
      </Sheet>
    </section>
  );
}
