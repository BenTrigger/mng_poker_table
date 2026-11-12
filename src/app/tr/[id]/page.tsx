"use client";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock, Share2, Copy, Check, Lock, LockOpen, Play, Hourglass, LogOut, Ban, UserPlus, Trophy, Pencil, Coins, Layers, Repeat,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { addGuest } from "@/lib/guests";
import { useAuth } from "@/lib/hooks";
import { useTournament, useNow } from "@/lib/tournament-hooks";
import { clockState, prizePool, rebuyLabel, tournamentError, tournamentInviteText } from "@/lib/tournament";
import { signupDate, signupTime, whatsappUrl } from "@/lib/signup";
import { formatMoney } from "@/lib/calc";
import { TopBar } from "@/components/top-bar";
import { PlaceInfo } from "@/components/place";
import { useGeocode } from "@/lib/waze";
import { Avatar, Badge, Button, Card, Empty, Sheet, Spinner, Toast, inputCls } from "@/components/ui";
import { T_STATUS, TournamentFormView } from "@/components/tournament-section";
import type { Member, TournamentEntryView } from "@/lib/types";
import { LiveView } from "./live";
import { ResultsView } from "./results";

export type RunFn = (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => Promise<boolean>;

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { view, loading, notFound, reload } = useTournament(id, !!user);
  const at = useGeocode(view?.tournament.address);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone?: "gold" | "loss" } | null>(null);
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState<"add" | "edit" | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersRev, setMembersRev] = useState(0);
  const [guest, setGuest] = useState("");
  const now = useNow(view?.tournament.status === "running");

  const isAdmin = view?.me?.role === "admin" && view.me.status === "active";
  const tableId = view?.table.id;

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

  const t = view?.tournament;
  const clock = useMemo(() => (t ? clockState(t, now) : null), [t, now]);

  if (authLoading || loading) return <Spinner />;
  if (notFound || !view || !t) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <Empty icon={<Trophy className="size-7" />} title="הטורניר לא נמצא" text="ייתכן שהקישור שגוי או שהמנהל מחק את הטורניר.">
          <Button variant="soft" onClick={() => router.push("/tables")}>לשולחנות שלי</Button>
        </Empty>
      </main>
    );
  }

  const { table, entries } = view;
  // a player who joined through this link holds their place while the admin approves them
  const myId = view.me && view.me.status !== "removed" ? view.me.id : null;
  const awaitingApproval = view.me?.status === "pending" && !!myId;
  const mine = entries.find((e) => e.member_id === myId) ?? null;
  const cap = t.table_count * t.seats_per_table;
  const inList = entries.filter((e) => e.status !== "waiting");
  const wait = entries.filter((e) => e.status === "waiting");
  const regOpen = t.registration_open && (t.status === "registration" || t.status === "running");
  const link = `${location.origin}/tr/${t.id}`;
  const shareText = tournamentInviteText(t, table.name, inList.map((e) => e.display_name), wait.length, link, at);

  const run: RunFn = async (key, fn, ok) => {
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    if (error) setToast({ text: tournamentError(error.message), tone: "loss" });
    else if (ok) setToast({ text: ok });
    await reload();
    return !error;
  };

  const register = () =>
    run("reg", () => supabase().rpc("register_tournament", { p_id: t.id }), t.status === "running" ? "נכנסת לטורניר. בהצלחה!" : "נרשמת לטורניר");
  const leave = () => run("leave", () => supabase().rpc("leave_tournament", { p_id: t.id }), "יצאת מההרשמה");
  const adminEntry = (member: string, add: boolean) =>
    run("admin", () => supabase().rpc("admin_tournament_entry", { p_id: t.id, p_member: member, p_add: add }));
  const update = (patch: Record<string, unknown>, ok?: string) => run("update", () => supabase().from("tournaments").update(patch).eq("id", t.id), ok);
  const start = () => run("start", () => supabase().rpc("start_tournament", { p_id: t.id }), "המקומות הוגרלו. בהצלחה לכולם!");

  // Admin: add a guest by name only (no Google account) and register them
  const addGuestEntry = async () => {
    setBusy("guest");
    let g;
    try {
      g = await addGuest(t.table_id, guest);
    } catch (e) {
      setBusy(null);
      setToast({ text: (e as Error).message, tone: "loss" });
      return;
    }
    setMembersRev((n) => n + 1);
    setGuest("");
    if (entries.some((e) => e.member_id === g.id)) {
      setBusy(null);
      setToast({ text: `${g.display_name} כבר רשום`, tone: "loss" });
      return;
    }
    await run("guest", () => supabase().rpc("admin_tournament_entry", { p_id: t.id, p_member: g.id, p_add: true }), `${g.display_name} נוסף כאורח`);
  };

  const notIn = members.filter((m) => !entries.some((e) => e.member_id === m.id));
  const st = T_STATUS[t.status];
  const regPhase = t.status === "registration";

  return (
    <>
      <TopBar title={t.name} sub={table.name} back={myId ? `/t/${table.code}` : "/tables"} />
      <Toast text={toast?.text ?? null} tone={toast?.tone} />
      <main className="mx-auto max-w-lg space-y-4 px-4 pb-44 pt-3">
        <Card className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-[family-name:var(--font-display)] text-2xl font-extrabold">{signupDate(t.starts_at)}</div>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-4" /> <span className="num">{signupTime(t.starts_at)}</span>
            </span>
          </div>
          <PlaceInfo host={t.location} address={t.address} at={at} />
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge tone="gold">
              <Coins className="size-3" /> כניסה {formatMoney(Number(t.buy_in))}
            </Badge>
            <Badge>
              <Layers className="size-3" /> {Number(t.starting_stack).toLocaleString()} צ'יפים
            </Badge>
            {rebuyLabel(t) && (
              <Badge>
                <Repeat className="size-3" /> {rebuyLabel(t)}
              </Badge>
            )}
            <Badge>{t.payment_mode === "upfront" ? "מזומן בכניסה" : "התחשבנות בסוף"}</Badge>
            {t.addon_price != null && <Badge>אד-און {formatMoney(Number(t.addon_price))}</Badge>}
            {t.late_reg_until_level > 0 && <Badge>הרשמה מאוחרת עד שלב {t.late_reg_until_level}</Badge>}
          </div>
          {t.note && <p className="text-sm">{t.note}</p>}
        </Card>

        {regPhase && (
          <>
            <Card className="felt rounded-[32px] p-6 text-center">
              <div className="text-[11px] font-bold text-white/60">{regOpen ? (inList.length < cap ? `${cap - inList.length} מקומות פנויים` : "הטורניר מלא") : "ההרשמה סגורה"}</div>
              <div className="num font-[family-name:var(--font-display)] text-5xl font-extrabold text-white">
                {inList.length}/{cap}
              </div>
              <div className="text-xs text-white/70">
                רשומים · {t.table_count > 1 ? `${t.table_count} שולחנות של ${t.seats_per_table}` : `שולחן אחד של ${t.seats_per_table}`}
              </div>
              {inList.length > 1 && (
                <div className="mt-2 text-xs font-bold text-gold">קופת פרסים כרגע: {formatMoney(prizePool(t, inList.map((e) => ({ ...e, status: "playing" as const }))))}</div>
              )}
            </Card>

            <EntryList title={`רשומים (${inList.length})`} list={inList} myId={myId} onRemove={isAdmin ? (e) => adminEntry(e.member_id, false) : undefined} busy={!!busy} />
            {wait.length > 0 && (
              <EntryList
                title="רשימת המתנה"
                icon={<Hourglass className="size-4" />}
                list={wait}
                myId={myId}
                onRemove={isAdmin ? (e) => adminEntry(e.member_id, false) : undefined}
                busy={!!busy}
                foot="כשמתפנה מקום, הראשון ברשימה עולה אוטומטית."
              />
            )}

            {isAdmin && (
              <section className="space-y-3">
                <h2 className="px-1 text-sm font-bold text-muted">ניהול הטורניר</h2>
                <Card className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="soft" onClick={() => setSheet("add")}>
                      <UserPlus className="size-4" /> הוספת שחקנים
                    </Button>
                    <Button variant="soft" onClick={() => setSheet("edit")}>
                      <Pencil className="size-4" /> עריכה
                    </Button>
                    {t.registration_open ? (
                      <Button variant="soft" loading={busy === "update"} onClick={() => update({ registration_open: false }, "ההרשמה נסגרה")}>
                        <Lock className="size-4" /> סגירת הרשמה
                      </Button>
                    ) : (
                      <Button variant="soft" loading={busy === "update"} onClick={() => update({ registration_open: true }, "ההרשמה נפתחה")}>
                        <LockOpen className="size-4" /> פתיחה מחדש
                      </Button>
                    )}
                    <Button variant="danger" onClick={() => confirm("לבטל את הטורניר?") && update({ status: "cancelled", registration_open: false }, "הטורניר בוטל")}>
                      <Ban className="size-4" /> ביטול
                    </Button>
                  </div>
                  <Button className="w-full" size="lg" disabled={inList.length < 2} loading={busy === "start"} onClick={() => confirm(`להגריל מקומות ל-${inList.length} שחקנים ולהתחיל?`) && start()}>
                    <Play className="size-5" /> הגרלת מקומות והתחלה
                  </Button>
                  <p className="text-center text-xs text-muted">השעון מתחיל לרוץ עם ההגרלה. אפשר לעצור אותו בכל רגע.</p>
                </Card>
              </section>
            )}
          </>
        )}

        {t.status === "running" && clock && (
          <LiveView
            t={t}
            entries={entries}
            clock={clock}
            now={now}
            isAdmin={isAdmin}
            myId={myId}
            busy={!!busy}
            run={run}
            onAdd={() => setSheet("add")}
          />
        )}

        {t.status === "finished" && <ResultsView view={view} isAdmin={isAdmin} myId={myId} run={run} />}

        {t.status === "cancelled" && (
          <Card className="text-center text-sm text-muted">
            הטורניר בוטל.
            {isAdmin && (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => update({ status: "registration", registration_open: true }, "הטורניר חזר להרשמה")}>
                החזרה להרשמה
              </Button>
            )}
          </Card>
        )}
      </main>

      {(regPhase || (t.status === "running" && (isAdmin || regOpen))) && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-lg gap-2">
            {mine && regPhase ? (
              <>
                <div className="flex flex-1 items-center gap-2 rounded-2xl bg-surface-2 px-4 font-bold">
                  {mine.status === "waiting" ? (
                    <>
                      <Hourglass className="size-5 text-gold" /> ממתין ({wait.findIndex((w) => w.member_id === myId) + 1})
                    </>
                  ) : (
                    <>
                      <Check className="size-5 text-win" /> אתה רשום
                    </>
                  )}
                </div>
                <Button size="lg" variant="danger" loading={busy === "leave"} onClick={() => confirm("לצאת מההרשמה?") && leave()} aria-label="יציאה מההרשמה">
                  <LogOut className="size-5" />
                </Button>
              </>
            ) : !mine && regOpen ? (
              <Button size="lg" className="flex-1" loading={busy === "reg"} onClick={register}>
                {inList.length < cap ? (
                  <>
                    <Trophy className="size-5" /> {t.status === "running" ? "כניסה מאוחרת" : "הרשמה לטורניר"}
                  </>
                ) : (
                  <>
                    <Hourglass className="size-5" /> לרשימת המתנה
                  </>
                )}
              </Button>
            ) : null}
            {isAdmin && (
              <>
                <a href={whatsappUrl(shareText)} target="_blank" rel="noreferrer" className={mine || !regOpen ? "flex-1" : ""}>
                  <Button size="lg" variant={mine || !regOpen ? "gold" : "soft"} className="w-full" aria-label="שיתוף בוואטסאפ">
                    <Share2 className="size-5" /> {mine || !regOpen ? "שיתוף בוואטסאפ" : ""}
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
            )}
            {!isAdmin && !mine && !regOpen && <p className="w-full py-3 text-center text-sm text-muted">ההרשמה סגורה</p>}
          </div>
          {awaitingApproval && mine && (
            <p className="mx-auto mt-2 max-w-lg text-center text-xs text-muted">המקום שמור לך. המנהל צריך לאשר אותך לשולחן, ואז תראה גם את הערבים והתוצאות.</p>
          )}
        </div>
      )}

      <Sheet open={sheet === "add"} onClose={() => setSheet(null)} title={t.status === "running" ? "כניסה מאוחרת" : "הוספת שחקנים"}>
        <div className="space-y-1">
          {t.status === "running" && <p className="mb-2 text-sm text-muted">השחקן מקבל כיסא בשולחן הכי קצר וערימת פתיחה מלאה.</p>}
          <div className="mb-3 flex gap-2">
            <input
              className={`${inputCls} h-11`}
              placeholder="אורח חדש (רק שם)"
              value={guest}
              maxLength={40}
              onChange={(e) => setGuest(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && guest.trim() && !busy && addGuestEntry()}
            />
            <Button size="md" variant="soft" loading={busy === "guest"} disabled={!guest.trim() || !!busy} onClick={addGuestEntry}>
              <UserPlus className="size-4" /> הוספה
            </Button>
          </div>
          {notIn.length === 0 ? (
            <p className="text-sm text-muted">כל השחקנים של השולחן כבר בפנים.</p>
          ) : (
            notIn.map((m) => (
              <button
                key={m.id}
                disabled={!!busy}
                onClick={() => adminEntry(m.id, true)}
                className="flex w-full items-center gap-3 rounded-2xl p-2 text-right hover:bg-white/5 disabled:opacity-40"
              >
                <Avatar name={m.display_name} src={m.avatar_url} size={34} />
                <span className="min-w-0 flex-1 truncate font-bold">{m.display_name}</span>
                {!m.user_id && <span className="text-xs text-warn">אורח</span>}
                <UserPlus className="size-4 text-muted" />
              </button>
            ))
          )}
        </div>
      </Sheet>

      <Sheet open={sheet === "edit"} onClose={() => setSheet(null)} title="עריכת טורניר">
        {sheet === "edit" && (
          <TournamentFormView
            tableId={table.id}
            existing={t}
            onSaved={async () => {
              setSheet(null);
              setToast({ text: "נשמר" });
              await reload();
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function EntryList({
  title, icon, list, myId, onRemove, busy, foot,
}: {
  title: string;
  icon?: React.ReactNode;
  list: TournamentEntryView[];
  myId: string | null;
  onRemove?: (e: TournamentEntryView) => void;
  busy: boolean;
  foot?: string;
}) {
  if (!list.length) return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1 px-1 text-sm font-bold text-muted">
        {icon} {title}
      </h2>
      <Card className="space-y-2 p-3">
        {list.map((e, i) => (
          <div key={e.id} className="flex items-center gap-3">
            <span className="num w-5 text-center text-sm text-muted">{i + 1}</span>
            <Avatar name={e.display_name} src={e.avatar_url} size={32} />
            <span className="min-w-0 flex-1 truncate font-bold">
              {e.display_name} {e.member_id === myId && <span className="text-xs text-muted">(אני)</span>}
            </span>
            {onRemove && (
              <button disabled={busy} onClick={() => confirm(`להוציא את ${e.display_name}?`) && onRemove(e)} className="rounded-full p-1.5 text-muted hover:bg-white/5" aria-label="הסרה">
                <Ban className="size-4" />
              </button>
            )}
          </div>
        ))}
        {foot && <p className="text-xs text-muted">{foot}</p>}
      </Card>
    </section>
  );
}
