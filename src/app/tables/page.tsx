"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, LogIn, ChevronLeft, LogOut, Spade } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks";
import { TopBar } from "@/components/top-bar";
import { Button, Card, Empty, Field, Sheet, Spinner, Badge, inputCls } from "@/components/ui";
import type { Member, PokerTable } from "@/lib/types";
import { VersionLabel } from "@/components/version-label";
import { PushCard } from "@/components/push-card";

type Row = Member & { poker_tables: PokerTable };

export default function TablesPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase()
      .from("table_members")
      .select("*, poker_tables(*)")
      .eq("user_id", user.id)
      .neq("status", "removed")
      .order("created_at", { ascending: false });
    setRows((data as Row[]) ?? []);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase().rpc("create_table", { p_name: name.trim() });
    setBusy(false);
    if (error) return setErr(error.message);
    router.push(`/t/${data.code}?tab=players`);
  }

  function join() {
    const c = code.trim().toUpperCase();
    if (c.length >= 4) router.push(`/join/${c}`);
  }

  if (loading || rows == null) return <Spinner />;

  return (
    <>
      <TopBar
        title={`היי ${profile?.display_name?.split(" ")[0] ?? ""}`}
        sub="השולחנות שלי"
        avatar={{ name: profile?.display_name ?? "", src: profile?.avatar_url }}
        right={
          <button
            className="rounded-full p-2 text-muted hover:bg-white/5"
            aria-label="יציאה"
            onClick={async () => {
              await supabase().auth.signOut();
              location.href = "/";
            }}
          >
            <LogOut className="size-5" />
          </button>
        }
      />
      <main className="mx-auto max-w-lg space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-5" /> שולחן חדש
          </Button>
          <Button variant="soft" onClick={() => setJoinOpen(true)}>
            <LogIn className="size-5" /> הצטרפות בקוד
          </Button>
        </div>

        {rows.length > 0 && <PushCard compact />}

        {rows.length === 0 ? (
          <Empty icon={<Spade className="size-7" />} title="עוד אין לך שולחנות" text="פתח שולחן חדש לחבר'ה, או הצטרף לשולחן קיים עם הקוד שלו." />
        ) : (
          rows.map((r) => (
            <Link key={r.id} href={r.status === "pending" ? `/join/${r.poker_tables?.code ?? ""}` : `/t/${r.poker_tables.code}`}>
              <Card className="mt-3 flex items-center gap-3 transition hover:border-gold/30">
                <div className="felt grid size-12 shrink-0 place-items-center rounded-2xl text-lg">♠</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{r.poker_tables?.name ?? "שולחן"}</div>
                  <div className="num text-xs tracking-widest text-muted">{r.poker_tables?.code}</div>
                </div>
                {r.role === "admin" && <Badge tone="gold">מנהל</Badge>}
                {r.status === "pending" && <Badge tone="warn">ממתין לאישור</Badge>}
                <ChevronLeft className="size-5 text-muted" />
              </Card>
            </Link>
          ))
        )}
        <VersionLabel />
      </main>

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title="שולחן חדש">
        <div className="space-y-4">
          <Field label="שם השולחן" hint="אתה תהיה המנהל. יווצר קוד קבוע שאפשר לשתף.">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="הפוקר של יום חמישי" autoFocus />
          </Field>
          {err && <p className="text-sm text-loss">{err}</p>}
          <Button className="w-full" disabled={!name.trim()} loading={busy} onClick={create}>
            יצירת שולחן
          </Button>
        </div>
      </Sheet>

      <Sheet open={joinOpen} onClose={() => setJoinOpen(false)} title="הצטרפות לשולחן">
        <div className="space-y-4">
          <Field label="קוד שולחן">
            <input
              className={`${inputCls} text-center text-2xl font-extrabold uppercase tracking-[0.4em]`}
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABC123"
              autoFocus
              dir="ltr"
            />
          </Field>
          <Button className="w-full" disabled={code.trim().length < 4} onClick={join}>
            המשך
          </Button>
        </div>
      </Sheet>
    </>
  );
}
