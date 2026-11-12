"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock, Share2, Copy, Check, Lock, LockOpen, Play, Hourglass, LogOut, Minus, Plus, Ban, UserPlus, ArrowDownToLine, Trash2, Armchair, Pencil,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { addGuest } from "@/lib/guests";
import { useAuth } from "@/lib/hooks";
import { PokerTable, type Seat } from "@/components/poker-table";
import { TopBar } from "@/components/top-bar";
import { PlaceInfo } from "@/components/place";
import { useGeocode } from "@/lib/waze";
import { Avatar, Badge, Button, Card, Empty, Field, Sheet, Spinner, Toast, inputCls } from "@/components/ui";
import { seatMap, signupDate, signupError, signupLink, signupShareText, signupTime, useSignup, waitingList, whatsappUrl } from "@/lib/signup";
import type { Member, SignupSeat } from "@/lib/types";

/** Date as a value for <input type="datetime-local"> in local time */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS = {
  open: { label: "ההרשמה פתוחה", tone: "win" },
  closed: { label: "ההרשמה סגורה", tone: "warn" },
  started: { label: "הערב התחיל", tone: "gold" },
  cancelled: { label: "הערב בוטל", tone: "loss" },
} as const;

export default function SignupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { view, loading, notFound, reload } = useSignup(id, !!user);
  const at = useGeocode(view?.signup.address);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone?: "gold" | "loss" } | null>(null);
  const [copied, setCopied] = useState(false);
  const [seatSheet, setSeatSheet] = useState<number | null>(null); // seat number the admin/player tapped
  const [members, setMembers] = useState<Member[]>([]);
  const [edit, setEdit] = useState<{ startsAt: string; place: string; address: string; note: string } | null>(null);

  const isAdmin = view?.me?.role === "admin" && view.me.status === "active";
  const tableId = view?.table.id;

  const [membersRev, setMembersRev] = useState(0);
  useEffect(() => {
    if (!isAdmin || !tableId) return;
    supabase()
      .from("table_members")
      .select("*")
      .eq("table_id", tableId)
      .eq("status", "active")
      .order("display_name")
      .then(({ data }) => setMembers(data ?? []));
  }, [isAdmin, tableId, membersRev]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  if (authLoading || loading) return <Spinner />;
  if (notFound || !view) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <Empty icon={<CalendarClock className="size-7" />} title="ההרשמה לא נמצאה" text="ייתכן שהקישור שגוי או שהמנהל מחק את ההרשמה.">
          <Button variant="soft" onClick={() => router.push("/tables")}>לשולחנות שלי</Button>
        </Empty>
      </main>
    );
  }

  const { signup: s, table, seats } = view;
  const myId = view.me?.status === "active" ? view.me.id : null;
  const mine = seats.find((x) => x.member_id === myId) ?? null;
  const map = seatMap(seats, s.seats);
  const wait = waitingList(seats);
  const taken = map.filter(Boolean).length;
  const free = s.seats - taken;
  const open = s.status === "open";
  // a seat can be given up until the night itself is opened, also after registration closed
  const canLeave = !!mine && (s.status === "open" || s.status === "closed");
  const askLeave = () => confirm(mine?.seat ? `לבטל את הכיסא שלך (מקום ${mine.seat})?` : "לצאת מרשימת ההמתנה?") && leave();
  const link = signupLink(location.origin, s.id);
  const shareText = signupShareText(table.name, s, seats, link, at);

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) {
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    if (error) setToast({ text: signupError(error.message), tone: "loss" });
    else if (ok) setToast({ text: ok });
    await reload();
    return !error;
  }

  const claim = (seat: number | null) =>
    run("claim", () => supabase().rpc("claim_seat", { p_signup: s.id, p_seat: seat }), seat ? `תפסת את מקום ${seat}` : undefined);
  const leave = () => run("leave", () => supabase().rpc("leave_signup", { p_signup: s.id }), "ההרשמה שלך בוטלה");
  const adminSeat = (member: string, seat: number | null) =>
    run("admin", () => supabase().rpc("admin_seat", { p_signup: s.id, p_member: member, p_seat: seat }));
  // Admin: add a guest by name (no Google account) straight into a seat (0 = waiting list)
  async function seatGuest(name: string, seat: number) {
    setBusy("guest");
    let guest;
    try {
      guest = await addGuest(table.id, name);
    } catch (e) {
      setBusy(null);
      setToast({ text: (e as Error).message, tone: "loss" });
      return false;
    }
    setMembersRev((n) => n + 1);
    if (seats.some((x) => x.member_id === guest.id && x.seat !== null)) {
      setBusy(null);
      setToast({ text: `${guest.display_name} כבר רשום`, tone: "loss" });
      return false;
    }
    return run("guest", () => supabase().rpc("admin_seat", { p_signup: s.id, p_member: guest.id, p_seat: seat }), `${guest.display_name} נוסף כאורח`);
  }
  const resize = (n: number) => run("resize", () => supabase().rpc("resize_signup", { p_signup: s.id, p_seats: n }));
  const setStatus = (status: "open" | "closed" | "cancelled") =>
    run("status", () => supabase().from("signups").update({ status }).eq("id", s.id), status === "open" ? "ההרשמה נפתחה" : status === "closed" ? "ההרשמה נסגרה" : "הערב בוטל");

  const editable = isAdmin && (s.status === "open" || s.status === "closed");
  const openEdit = () => setEdit({ startsAt: toLocalInput(new Date(s.starts_at)), place: s.location ?? "", address: s.address ?? "", note: s.note ?? "" });
  async function saveEdit() {
    if (!edit?.startsAt) return;
    const ok = await run(
      "edit",
      () =>
        supabase()
          .from("signups")
          .update({ starts_at: new Date(edit.startsAt).toISOString(), location: edit.place.trim() || null, address: edit.address.trim() || null, note: edit.note.trim() || null })
          .eq("id", s.id)
          .select("id")
          .single(),
      "הפרטים עודכנו",
    );
    if (ok) setEdit(null);
  }

  function tapSeat(i: number) {
    const who = map[i];
    if (isAdmin) return setSeatSheet(i + 1);
    if (!open) return;
    if (!who) return claim(i + 1);
    if (who.member_id === myId) setSeatSheet(i + 1);
  }

  const tableSeats: Seat[] = map.map((p, i) =>
    p
      ? { id: String(i), name: p.display_name, avatar: p.avatar_url, amount: `#${i + 1}`, tone: p.member_id === myId ? "gold" : "muted", isMe: p.member_id === myId }
      : { id: String(i), name: open ? "פנוי" : "—", amount: `#${i + 1}`, tone: "muted", empty: true },
  );

  const sheetWho = seatSheet ? map[seatSheet - 1] : null;
  const unseated = members.filter((m) => !seats.some((x) => x.member_id === m.id && x.seat !== null));

  return (
    <>
      <TopBar title="הרשמה לערב" sub={table.name} back={myId ? `/t/${table.code}` : "/tables"} />
      <Toast text={toast?.text ?? null} tone={toast?.tone} />
      <main className={`mx-auto max-w-lg space-y-4 px-4 pt-3 ${isAdmin ? "pb-52" : "pb-36"}`}>
        <Card className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-[family-name:var(--font-display)] text-2xl font-extrabold">{signupDate(s.starts_at)}</div>
            <div className="flex items-center gap-2">
              <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
              {editable && (
                <Button size="sm" variant="soft" onClick={openEdit} aria-label="עריכת תאריך, מארח וכתובת">
                  <Pencil className="size-4" /> עריכה
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-4" /> <span className="num">{signupTime(s.starts_at)}</span>
            </span>
          </div>
          <PlaceInfo host={s.location} address={s.address} at={at} />
          {s.note && <p className="text-sm">{s.note}</p>}
        </Card>

        <PokerTable
          seats={tableSeats}
          onSeat={(sid) => tapSeat(Number(sid))}
          center={
            <div>
              <div className="text-[11px] font-bold text-white/60">{open ? (free ? `${free} מקומות פנויים` : "השולחן מלא") : STATUS[s.status].label}</div>
              <div className="num font-[family-name:var(--font-display)] text-4xl font-extrabold text-white">
                {taken}/{s.seats}
              </div>
              <div className="text-[11px] text-white/60">רשומים</div>
              {wait.length > 0 && <div className="mt-1 text-[11px] font-bold text-gold">{wait.length} ממתינים</div>}
              {open && !mine && free > 0 && <div className="mt-2 text-[11px] text-white/70">לחץ על כיסא פנוי כדי לשבת</div>}
            </div>
          }
        />

        {s.status === "started" && s.night_id && (
          <Link href={`/t/${table.code}/n/${s.night_id}`}>
            <Button size="lg" className="w-full">
              <Play className="size-5" /> לערב הפעיל
            </Button>
          </Link>
        )}

        {wait.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-1 px-1 text-sm font-bold text-muted">
              <Hourglass className="size-4" /> רשימת המתנה
            </h2>
            <Card className="space-y-2 p-3">
              {wait.map((w, i) => (
                <div key={w.member_id} className="flex items-center gap-3">
                  <span className="num w-5 text-center text-sm text-muted">{i + 1}</span>
                  <Avatar name={w.display_name} src={w.avatar_url} size={32} />
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {w.display_name} {w.member_id === myId && <span className="text-xs text-muted">(אני)</span>}
                  </span>
                  {isAdmin && open && free > 0 && (
                    <Button size="sm" variant="soft" onClick={() => adminSeat(w.member_id, map.findIndex((x) => !x) + 1)}>
                      <Armchair className="size-4" /> להושיב
                    </Button>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted">כשמתפנה מקום, הראשון ברשימה עולה לשולחן אוטומטית.</p>
            </Card>
          </section>
        )}

        {isAdmin && (
          <section className="space-y-3">
            <h2 className="px-1 text-sm font-bold text-muted">ניהול ההרשמה</h2>
            <Card className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex-1 font-bold">מספר מקומות</span>
                <Button size="sm" variant="soft" disabled={s.seats <= 2 || !!busy} onClick={() => resize(s.seats - 1)} aria-label="פחות">
                  <Minus className="size-4" />
                </Button>
                <span className="num w-8 text-center text-xl font-extrabold">{s.seats}</span>
                <Button size="sm" variant="soft" disabled={s.seats >= 10 || !!busy} onClick={() => resize(s.seats + 1)} aria-label="יותר">
                  <Plus className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted">לחיצה על כיסא פנוי: להושיב שחקן מהשולחן או אורח לפי שם בלבד (בלי חשבון).</p>
              {map.slice(s.seats - 1).some(Boolean) && <p className="text-xs text-muted">הורדת מקום מעבירה את מי שיושב בכיסא האחרון לראש רשימת ההמתנה.</p>}
              <div className="grid grid-cols-2 gap-2">
                {open ? (
                  <Button variant="soft" loading={busy === "status"} onClick={() => setStatus("closed")}>
                    <Lock className="size-4" /> סגירת הרשמה
                  </Button>
                ) : s.status === "closed" ? (
                  <Button variant="soft" loading={busy === "status"} onClick={() => setStatus("open")}>
                    <LockOpen className="size-4" /> פתיחה מחדש
                  </Button>
                ) : null}
                {(open || s.status === "closed") && (
                  <Button variant="danger" loading={busy === "status"} onClick={() => confirm("לבטל את הערב? ההרשמה תיסגר.") && setStatus("cancelled")}>
                    <Ban className="size-4" /> ביטול ערב
                  </Button>
                )}
              </div>
              {(open || s.status === "closed") && (
                <Link href={`/t/${table.code}/new-night?signup=${s.id}`} className="block">
                  <Button className="w-full" disabled={taken < 2}>
                    <Play className="size-4" /> פתיחת הערב עם הרשומים ({taken})
                  </Button>
                </Link>
              )}
            </Card>
          </section>
        )}
      </main>

      {(s.status === "open" || s.status === "closed") && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-lg gap-2">
            {isAdmin ? (
              <>
                <a href={whatsappUrl(shareText)} target="_blank" rel="noreferrer" className="flex-1">
                  <Button size="lg" className="w-full">
                    <Share2 className="size-5" /> שיתוף בוואטסאפ
                  </Button>
                </a>
                <Button
                  size="lg"
                  variant="soft"
                  aria-label="העתקת קישור"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(link);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
                </Button>
              </>
            ) : mine ? (
              <>
                <div className="flex flex-1 items-center gap-2 rounded-2xl bg-surface-2 px-4 font-bold">
                  {mine.seat ? (
                    <>
                      <Armchair className="size-5 text-gold" /> אתה במקום {mine.seat}
                    </>
                  ) : (
                    <>
                      <Hourglass className="size-5 text-gold" /> ממתין ({wait.findIndex((w) => w.member_id === myId) + 1})
                    </>
                  )}
                </div>
                {canLeave && (
                  <Button size="lg" variant="danger" loading={busy === "leave"} onClick={askLeave}>
                    <LogOut className="size-5" /> ביטול הרשמה
                  </Button>
                )}
              </>
            ) : open ? (
              <Button size="lg" className="w-full" loading={busy === "claim"} onClick={() => claim(null)}>
                {free > 0 ? (
                  <>
                    <Armchair className="size-5" /> תפוס לי מקום
                  </>
                ) : (
                  <>
                    <Hourglass className="size-5" /> הצטרפות לרשימת המתנה
                  </>
                )}
              </Button>
            ) : (
              <p className="w-full py-3 text-center text-sm text-muted">ההרשמה סגורה</p>
            )}
          </div>
          {isAdmin && open && !mine && (
            <div className="mx-auto mt-2 max-w-lg">
              <Button size="sm" variant="ghost" className="w-full" loading={busy === "claim"} onClick={() => claim(null)}>
                <Armchair className="size-4" /> גם אני משחק: תפוס לי מקום
              </Button>
            </div>
          )}
          {isAdmin && canLeave && mine && (
            <div className="mx-auto mt-2 flex max-w-lg items-center gap-2">
              <span className="flex flex-1 items-center gap-1.5 text-sm font-bold">
                {mine.seat ? <Armchair className="size-4 text-gold" /> : <Hourglass className="size-4 text-gold" />}
                {mine.seat ? `אתה במקום ${mine.seat}` : "אתה ברשימת ההמתנה"}
              </span>
              <Button size="sm" variant="danger" loading={busy === "leave"} onClick={askLeave}>
                <LogOut className="size-4" /> ביטול הכיסא שלי
              </Button>
            </div>
          )}
        </div>
      )}

      <Sheet open={seatSheet !== null} onClose={() => setSeatSheet(null)} title={`מקום ${seatSheet ?? ""}`}>
        {seatSheet !== null && (
          <SeatSheet
            who={sheetWho}
            isMine={sheetWho?.member_id === myId}
            isAdmin={isAdmin}
            open={open}
            canLeave={canLeave}
            candidates={unseated}
            busy={!!busy}
            onLeave={async () => (await leave()) && setSeatSheet(null)}
            onSeat={async (member) => (await adminSeat(member, seatSheet)) && setSeatSheet(null)}
            onToWait={async (member) => (await adminSeat(member, 0)) && setSeatSheet(null)}
            onRemove={async (member) => (await adminSeat(member, null)) && setSeatSheet(null)}
            onTakeMyself={async () => (await claim(seatSheet)) && setSeatSheet(null)}
            onGuest={async (name) => (await seatGuest(name, seatSheet)) && setSeatSheet(null)}
            canTakeMyself={!sheetWho && open && mine?.seat !== seatSheet}
          />
        )}
      </Sheet>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title="עריכת פרטי הערב">
        {edit && (
          <div className="space-y-4">
            <Field label="מתי">
              <input type="datetime-local" className={inputCls} value={edit.startsAt} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} />
            </Field>
            <Field label="מארח (לא חובה)">
              <input className={inputCls} placeholder="אצל יוסי" value={edit.place} onChange={(e) => setEdit({ ...edit, place: e.target.value })} />
            </Field>
            <Field label="כתובת (לא חובה)" hint="החברים יוכלו לנווט אליה בוויז בלחיצה.">
              <input className={inputCls} placeholder="הרצל 10, תל אביב" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </Field>
            <Field label="הערה (לא חובה)">
              <input className={inputCls} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </Field>
            <p className="text-xs text-muted">הרשומים נשארים במקומות שלהם. כדאי לשתף שוב בוואטסאפ כדי שכולם יראו את התאריך החדש.</p>
            <Button className="w-full" size="lg" disabled={!edit.startsAt} loading={busy === "edit"} onClick={saveEdit}>
              <Check className="size-5" /> שמירה
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}

function SeatSheet(p: {
  who: SignupSeat | null;
  isMine: boolean;
  isAdmin: boolean;
  open: boolean;
  canLeave: boolean;
  candidates: Member[];
  busy: boolean;
  canTakeMyself: boolean;
  onLeave: () => void;
  onSeat: (member: string) => void;
  onToWait: (member: string) => void;
  onRemove: (member: string) => void;
  onTakeMyself: () => void;
  onGuest: (name: string) => void;
}) {
  const [guest, setGuest] = useState("");
  if (p.who) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Avatar name={p.who.display_name} src={p.who.avatar_url} size={48} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-bold">{p.who.display_name}</div>
            {!p.who.user_id && <div className="text-xs text-warn">עוד לא נרשם לאפליקציה</div>}
          </div>
        </div>
        {p.isMine && p.canLeave && (
          <Button variant="danger" className="w-full" disabled={p.busy} onClick={p.onLeave}>
            <LogOut className="size-4" /> ביטול הכיסא שלי
          </Button>
        )}
        {p.isAdmin && !p.isMine && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="soft" disabled={p.busy} onClick={() => p.onToWait(p.who!.member_id)}>
              <ArrowDownToLine className="size-4" /> להמתנה
            </Button>
            <Button variant="danger" disabled={p.busy} onClick={() => p.onRemove(p.who!.member_id)}>
              <Trash2 className="size-4" /> הסרה
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {p.canTakeMyself && (
        <Button className="w-full" disabled={p.busy} onClick={p.onTakeMyself}>
          <Armchair className="size-4" /> לשבת כאן
        </Button>
      )}
      {p.isAdmin && (
        <>
          <div>
            <p className="mb-2 text-sm text-muted">אורח בלי חשבון גוגל? רק שם, והוא נשמר בשולחן לפעם הבאה:</p>
            <div className="flex gap-2">
              <input
                className={`${inputCls} h-11`}
                placeholder="שם האורח"
                value={guest}
                maxLength={40}
                onChange={(e) => setGuest(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && guest.trim() && !p.busy && p.onGuest(guest)}
              />
              <Button size="md" variant="soft" disabled={!guest.trim() || p.busy} onClick={() => p.onGuest(guest)}>
                <UserPlus className="size-4" /> הושבה
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted">או להושיב שחקן מהשולחן (כולל אורחים מפעמים קודמות):</p>
          {p.candidates.length === 0 ? (
            <p className="text-sm text-muted">כל השחקנים כבר יושבים.</p>
          ) : (
            <div className="max-h-[45dvh] space-y-1 overflow-y-auto">
              {p.candidates.map((m) => (
                <button
                  key={m.id}
                  disabled={p.busy}
                  onClick={() => p.onSeat(m.id)}
                  className="flex w-full items-center gap-3 rounded-2xl p-2 text-right hover:bg-white/5 disabled:opacity-40"
                >
                  <Avatar name={m.display_name} src={m.avatar_url} size={34} />
                  <span className="min-w-0 flex-1 truncate font-bold">{m.display_name}</span>
                  {!m.user_id && <span className="text-xs text-warn">אורח</span>}
                  <UserPlus className="size-4 text-muted" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
