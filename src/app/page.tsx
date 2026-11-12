"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { signInWithGoogle } from "@/lib/hooks";
import { Button, ChipDot } from "@/components/ui";
import { Camera, Landmark, Share2, TrendingUp } from "lucide-react";

export default function Landing() {
  const [checking, setChecking] = useState(true);
  const [next, setNext] = useState("/tables");

  useEffect(() => {
    const n = new URLSearchParams(location.search).get("next");
    const target = n && n.startsWith("/") && !n.startsWith("//") ? n : "/tables";
    setNext(target);
    supabase().auth.getUser().then(({ data }) => {
      if (data.user) location.replace(target);
      else setChecking(false);
    });
  }, []);

  const features = [
    { icon: <Landmark className="size-5" />, t: "קופאי לכל ערב", d: "בקשות צ'יפים באפליקציה, אישור רק אחרי מסירה" },
    { icon: <Camera className="size-5" />, t: "הוכחה בתמונה", d: "צילום כל ערימה וספירת צ'יפים לפי צבעים" },
    { icon: <Share2 className="size-5" />, t: "מי חייב למי", d: "סיכום ערב במינימום העברות ושיתוף לוואטסאפ" },
    { icon: <TrendingUp className="size-5" />, t: "סטטיסטיקות", d: "ממוצעים, סה\"כ, שיאים ודירוג לאורך זמן" },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-6 pb-10 pt-[max(3rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-2">
        <ChipDot hex="#d7263d" size={22} />
        <span className="font-[family-name:var(--font-display)] text-lg font-extrabold">All In</span>
      </div>

      <div className="relative my-10">
        <div className="felt mx-auto grid aspect-[5/3] w-full place-items-center rounded-[50%]">
          <div className="flex -space-x-3 space-x-reverse">
            {["#f1f1f1", "#d7263d", "#1b998b", "#1c1c1c", "#7b2cbf"].map((c, i) => (
              <div key={c} className="chip-drop" style={{ animationDelay: `${i * 90}ms` }}>
                <ChipDot hex={c} size={44} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <h1 className="font-[family-name:var(--font-display)] text-4xl font-extrabold leading-tight">
        ניהול ערב פוקר,
        <br />
        <span className="gold-text">בלי ויכוחים.</span>
      </h1>
      <p className="mt-3 text-muted">הקופה, הצ'יפים והחובות של השולחן שלכם, במקום אחד ובזמן אמת.</p>

      <div className="mt-8 grid grid-cols-2 gap-3">
        {features.map((f) => (
          <div key={f.t} className="rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 text-gold">{f.icon}</div>
            <div className="text-sm font-bold">{f.t}</div>
            <div className="mt-0.5 text-xs text-muted">{f.d}</div>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-10">
        <Button size="lg" className="w-full" loading={checking} onClick={() => signInWithGoogle(next)}>
          <GoogleIcon />
          כניסה עם Google
        </Button>
        <p className="mt-3 text-center text-xs text-muted">האפליקציה רק מתעדת. היא לא מחזיקה ולא מעבירה כסף.</p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
