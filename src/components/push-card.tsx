"use client";
import { useEffect, useState } from "react";
import { BellRing, BellOff, Smartphone, X } from "lucide-react";
import { Button, Card } from "./ui";
import { disablePush, enablePush, getPushState, sendTestPush, type PushState } from "@/lib/push-client";

const NUDGE_KEY = "allin:push-nudge-dismissed";

/**
 * Turn phone notifications on/off for this device.
 * compact: a one-time nudge (tables screen) that only shows while push is off.
 */
export function PushCard({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    getPushState().then(setState).catch(() => setState("unsupported"));
    try {
      setDismissed(!!localStorage.getItem(NUDGE_KEY));
    } catch {}
  }, []);

  if (!state) return null;
  if (compact && (state !== "off" || dismissed)) return null;

  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const s = await enablePush();
      setState(s);
      if (s === "on") setMsg("מעולה! מעכשיו תקבל התראה כשמתחיל משחק או כשמשהו משתנה.");
    } catch {
      setMsg("לא הצלחנו להפעיל התראות במכשיר הזה. נסה שוב.");
    }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true);
    setState(await disablePush().catch(() => "off" as const));
    setMsg(null);
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    const r = await sendTestPush().catch(() => ({ ok: false }));
    setMsg(r.ok ? "נשלחה התראת בדיקה. היא אמורה להופיע בעוד רגע." : "השליחה לא הצליחה. כבה והדלק את ההתראות ונסה שוב.");
    setBusy(false);
  };

  if (compact) {
    return (
      <Card className="relative flex items-center gap-3 border-gold/30">
        <div className="grid size-11 shrink-0 place-items-center rounded-full bg-gold/10 text-gold">
          <BellRing className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold">לקבל התראה כשמתחיל משחק?</div>
          <div className="text-xs text-muted">וגם כשמשתנים תאריך, שעה או כתובת</div>
        </div>
        <Button size="sm" loading={busy} onClick={turnOn}>
          הפעלה
        </Button>
        <button
          className="absolute left-1 top-1 rounded-full p-1 text-muted hover:bg-white/5"
          aria-label="לא עכשיו"
          onClick={() => {
            try {
              localStorage.setItem(NUDGE_KEY, "1");
            } catch {}
            setDismissed(true);
          }}
        >
          <X className="size-4" />
        </button>
      </Card>
    );
  }

  return (
    <Card className="space-y-3" data-testid="push-card">
      <div className="flex items-center gap-3">
        <div className={`grid size-11 shrink-0 place-items-center rounded-full ${state === "on" ? "bg-win/15 text-win" : "bg-gold/10 text-gold"}`}>
          {state === "on" ? <BellRing className="size-5" /> : state === "ios-install" ? <Smartphone className="size-5" /> : <BellOff className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold">התראות לטלפון</div>
          <div className="text-xs text-muted">
            {state === "on" && "פועלות במכשיר הזה"}
            {state === "off" && "כבויות במכשיר הזה"}
            {state === "denied" && "חסומות בהגדרות הדפדפן"}
            {state === "ios-install" && "באייפון ההתראות עובדות רק מהאפליקציה המותקנת"}
            {state === "unsupported" && "הדפדפן הזה לא תומך בהתראות"}
            {state === "not-configured" && "ההתראות לטלפון עוד לא הופעלו בשרת"}
          </div>
        </div>
        {state === "off" && (
          <Button size="sm" loading={busy} onClick={turnOn}>
            הפעלה
          </Button>
        )}
      </div>
      {state === "on" && (
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="soft" loading={busy} onClick={test}>
            שלח לי בדיקה
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={turnOff}>
            כיבוי במכשיר הזה
          </Button>
        </div>
      )}
      {state === "denied" && (
        <p className="text-xs text-muted">
          כדי לאפשר: פתח את הגדרות האתר בדפדפן (סמל המנעול ליד הכתובת) ← הרשאות ← התראות ← אפשר. אחר כך חזור לכאן.
        </p>
      )}
      {state === "ios-install" && (
        <p className="text-xs text-muted">
          בספארי: כפתור השיתוף ← &quot;הוספה למסך הבית&quot;, ואז פתח את האפליקציה מהאייקון וחזור למסך הזה כדי להפעיל. עד אז ההתראות מחכות לך כאן ברשימה.
        </p>
      )}
      {msg && <p className="text-sm text-gold">{msg}</p>}
    </Card>
  );
}
