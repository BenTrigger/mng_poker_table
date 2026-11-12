"use client";
import { useEffect, useState } from "react";
import { Download, Share, PlusSquare, Smartphone, X, MoreVertical } from "lucide-react";
import { Sheet, Button } from "./ui";
import { detectPlatform, getInstallPrompt, isInstalled, promptInstall, subscribeInstall, type Platform } from "@/lib/install-prompt";

const DISMISS_KEY = "allin:install-dismissed";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function snoozed() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY));
    return !!t && Date.now() - t < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * A slim strip that sits right above a bottom menu bar and invites phone users
 * to install the app: one tap on Android, a short guide on iPhone.
 * Hidden when already installed, on desktop, or for a week after "not now".
 */
export function InstallBanner() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);
    setHidden(p === "desktop" || isInstalled() || snoozed());
    const sync = () => {
      setCanPrompt(!!getInstallPrompt());
      if (isInstalled()) setHidden(true);
    };
    sync();
    return subscribeInstall(sync);
  }, []);

  if (hidden || !platform) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setHidden(true);
  };
  const install = async () => {
    if (platform === "android" && canPrompt) {
      if (await promptInstall()) setHidden(true);
    } else setGuide(true);
  };

  return (
    <>
      <div className="border-b border-line bg-gold/10" data-testid="install-banner">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-sm font-bold">התקינו את All In</div>
            <div className="truncate text-xs text-muted">פתיחה מהירה מהמסך הראשי, כמו אפליקציה</div>
          </div>
          <Button size="sm" onClick={install}>
            {platform === "ios" ? <Share className="size-4" /> : <Download className="size-4" />}
            {platform === "ios" ? "איך מתקינים" : "התקנה"}
          </Button>
          <button onClick={dismiss} className="rounded-full p-1.5 text-muted hover:bg-white/5" aria-label="לא עכשיו">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <Sheet open={guide} onClose={() => setGuide(false)} title="התקנת האפליקציה">
        {platform === "ios" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">באייפון מתקינים דרך Safari, בשלושה צעדים:</p>
            <Step n={1} icon={<Share className="size-4" />} text="לוחצים על כפתור השיתוף (ריבוע עם חץ למעלה) בתחתית המסך" />
            <Step n={2} icon={<PlusSquare className="size-4" />} text='גוללים ובוחרים "הוסף למסך הבית"' />
            <Step n={3} icon={<Smartphone className="size-4" />} text='לוחצים "הוסף" ופותחים את All In מהמסך הראשי' />
            <p className="pt-1 text-xs text-muted">פתחתם מתוך וואטסאפ? לחצו קודם על שלוש הנקודות ובחרו "פתח ב-Safari".</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">הדפדפן לא הציע התקנה ישירה. אפשר להתקין ידנית ב-Chrome:</p>
            <Step n={1} icon={<MoreVertical className="size-4" />} text="פותחים את התפריט (שלוש נקודות למעלה)" />
            <Step n={2} icon={<Download className="size-4" />} text='בוחרים "התקנת אפליקציה" או "הוספה למסך הבית"' />
          </div>
        )}
        <Button className="mt-5 w-full" variant="soft" onClick={() => setGuide(false)}>
          הבנתי
        </Button>
      </Sheet>
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
