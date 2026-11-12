"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hourglass, Spade } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks";
import { Button, Empty, Spinner } from "@/components/ui";

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const { user, loading } = useAuth();
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "pending" | "error" | "busy">("idle");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase()
      .rpc("peek_table", { p_code: code })
      .then(({ data }) => setName(data?.[0]?.name ?? ""));
  }, [user, code]);

  async function join() {
    setState("busy");
    const member = new URLSearchParams(location.search).get("m");
    const { data, error } = await supabase().rpc("join_table", { p_code: code, p_member: member });
    if (error) {
      setErr(error.message.includes("removed") ? "הוסרת מהשולחן הזה." : error.message.includes("not found") ? "לא מצאנו שולחן עם הקוד הזה." : error.message);
      return setState("error");
    }
    if (data === "active") router.replace(`/t/${code.toUpperCase()}`);
    else setState("pending");
  }

  // personal invite links join immediately
  useEffect(() => {
    if (user && name && new URLSearchParams(location.search).get("m")) join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, name]);

  if (loading || name === null) return <Spinner />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center p-6">
      {name === "" ? (
        <Empty icon={<Spade className="size-7" />} title="שולחן לא נמצא" text="בדוק את הקוד ונסה שוב." />
      ) : state === "pending" ? (
        <Empty icon={<Hourglass className="size-7" />} title="הבקשה נשלחה" text={`מנהל "${name}" צריך לאשר אותך. ברגע שיאשר, השולחן יופיע אצלך.`}>
          <Button variant="soft" onClick={() => router.push("/tables")}>לשולחנות שלי</Button>
        </Empty>
      ) : (
        <div className="text-center">
          <div className="felt mx-auto mb-6 grid size-24 place-items-center rounded-full text-4xl">♠</div>
          <p className="text-muted">הוזמנת לשולחן</p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-extrabold">{name}</h1>
          <p dir="ltr" className="num mt-2 tracking-[0.3em] text-muted">{code.toUpperCase()}</p>
          {state === "error" && <p className="mt-4 text-loss">{err}</p>}
          <Button size="lg" className="mt-8 w-full" loading={state === "busy"} onClick={join}>
            הצטרפות
          </Button>
        </div>
      )}
    </main>
  );
}
