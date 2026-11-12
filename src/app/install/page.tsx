"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Share, PlusSquare, Smartphone, Check, MoreVertical } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { TopBar } from "@/components/top-bar";
import { APP_VERSION } from "@/lib/changelog";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function InstallPage() {
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");
  const [prompt, setPrompt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const apk = process.env.NEXT_PUBLIC_APK_URL;

  useEffect(() => {
    const ua = navigator.userAgent;
    setPlatform(/iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "desktop");
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const h = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  return (
    <>
      <TopBar title="התקנת האפליקציה" sub={`גרסה ${APP_VERSION}`} back="/tables" />
      <main className="mx-auto max-w-lg space-y-4 p-4">
        <div className="flex flex-col items-center py-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="size-24 rounded-[28px] shadow-2xl" />
          <h2 className="mt-4 font-[family-name:var(--font-display)] text-2xl font-extrabold">All In</h2>
          <p className="mt-1 text-sm text-muted">מתעדכנת לבד. כל פיצ'ר חדש מגיע אוטומטית בלי להתקין מחדש.</p>
        </div>

        {installed ? (
          <Card className="flex items-center gap-3 text-win">
            <Check className="size-5" /> האפליקציה כבר מותקנת אצלך
          </Card>
        ) : platform === "ios" ? (
          <Card className="space-y-3">
            <div className="font-bold">באייפון (Safari):</div>
            <Step n={1} icon={<Share className="size-4" />} text="לחץ על כפתור השיתוף בתחתית המסך" />
            <Step n={2} icon={<PlusSquare className="size-4" />} text='בחר "הוסף למסך הבית"' />
            <Step n={3} icon={<Smartphone className="size-4" />} text="פתח את All In מהמסך הראשי" />
          </Card>
        ) : (
          <div className="space-y-3">
            {prompt && (
              <Button size="lg" className="w-full" onClick={() => prompt.prompt().then(() => setPrompt(null))}>
                <Download className="size-5" /> התקנה בלחיצה
              </Button>
            )}
            {platform === "android" && apk && (
              <a href={apk} className="block">
                <Button size="lg" variant="soft" className="w-full">
                  <Smartphone className="size-5" /> הורדת APK לאנדרואיד
                </Button>
              </a>
            )}
            {!prompt && (
              <Card className="space-y-3">
                <div className="font-bold">{platform === "android" ? "באנדרואיד (Chrome):" : "במחשב (Chrome / Edge):"}</div>
                <Step n={1} icon={<MoreVertical className="size-4" />} text={platform === "android" ? "פתח את התפריט (שלוש נקודות)" : "לחץ על סמל ההתקנה בשורת הכתובת"} />
                <Step n={2} icon={<Download className="size-4" />} text='בחר "התקנת אפליקציה" או "הוספה למסך הבית"' />
              </Card>
            )}
          </div>
        )}

        <p className="pt-4 text-center text-xs text-muted">
          <Link href="/tables" className="underline">
            חזרה לשולחנות
          </Link>
        </p>
      </main>
    </>
  );
}

function Step({ n, icon, text }: { n: number; icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gold/15 font-bold text-gold">{n}</span>
      <span className="text-gold">{icon}</span>
      <span>{text}</span>
    </div>
  );
}
