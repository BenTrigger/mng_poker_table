"use client";
import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spade, Users, History, BarChart3, Settings } from "lucide-react";
import { useAuth, useTable } from "@/lib/hooks";
import { TopBar } from "@/components/top-bar";
import { Empty, Spinner, Button } from "@/components/ui";
import { NightTab, PlayersTab, HistoryTab, StatsTab, SettingsTab } from "./tabs";

const TABS = [
  { id: "night", label: "ערב", icon: Spade },
  { id: "players", label: "שחקנים", icon: Users },
  { id: "history", label: "היסטוריה", icon: History },
  { id: "stats", label: "סטטיסטיקה", icon: BarChart3 },
  { id: "settings", label: "הגדרות", icon: Settings },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function TablePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const { user, profile, loading: authLoading } = useAuth();
  const t = useTable(code, user?.id);
  const [tab, setTab] = useState<TabId>((search.get("tab") as TabId) || "night");

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    q.set("tab", tab);
    history.replaceState(null, "", `?${q}`);
  }, [tab]);

  if (authLoading || t.loading) return <Spinner />;
  if (t.notFound || !t.table || !t.me || t.me.status !== "active") {
    return (
      <main className="mx-auto max-w-lg p-6">
        <Empty icon={<Spade className="size-7" />} title={t.me?.status === "pending" ? "ממתין לאישור המנהל" : "אין לך גישה לשולחן הזה"}>
          <Button variant="soft" onClick={() => router.push("/tables")}>לשולחנות שלי</Button>
        </Empty>
      </main>
    );
  }

  const tabs = TABS.filter((x) => x.id !== "settings" || t.isAdmin);
  const pendingCount = t.members.filter((m) => m.status === "pending").length;
  const ctx = { ...t, table: t.table, me: t.me, userId: user!.id, profile };

  return (
    <>
      <TopBar title={t.table.name} sub={`קוד שולחן ${t.table.code}`} back="/tables" avatar={{ name: profile?.display_name ?? "", src: profile?.avatar_url }} />
      <main className="mx-auto max-w-lg p-4 pb-28">
        {tab === "night" && <NightTab ctx={ctx} />}
        {tab === "players" && <PlayersTab ctx={ctx} />}
        {tab === "history" && <HistoryTab ctx={ctx} />}
        {tab === "stats" && <StatsTab ctx={ctx} />}
        {tab === "settings" && t.isAdmin && <SettingsTab ctx={ctx} />}
      </main>
      <nav className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold ${tab === id ? "text-gold" : "text-muted"}`}>
              <Icon className="size-5" />
              {label}
              {id === "players" && pendingCount > 0 && t.isAdmin && (
                <span className="absolute right-[30%] top-1.5 grid size-4 place-items-center rounded-full bg-loss text-[10px] text-white">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
