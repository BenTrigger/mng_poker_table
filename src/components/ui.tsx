"use client";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { X, Loader2 } from "lucide-react";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "gold" | "ghost" | "danger" | "soft";
  size?: "md" | "lg" | "sm";
  loading?: boolean;
};

export function Button({ variant = "gold", size = "md", loading, className = "", children, disabled, ...rest }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl font-bold transition active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 select-none";
  const sizes = { sm: "h-9 px-3 text-sm", md: "h-12 px-5 text-base", lg: "h-14 px-6 text-lg" }[size];
  const variants = {
    gold: "bg-gradient-to-b from-[#ffd77a] to-gold-2 text-[#1d1405] shadow-[0_8px_24px_-8px_rgb(233_185_73/0.6)]",
    ghost: "bg-transparent text-ink border border-line hover:bg-white/5",
    soft: "bg-surface-2 text-ink border border-line hover:bg-white/5",
    danger: "bg-loss/15 text-loss border border-loss/30",
  }[variant];
  return (
    <button className={`${base} ${sizes} ${variants} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className = "", children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-3xl border border-line bg-surface p-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Avatar({ name, src, size = 40, ring }: { name: string; src?: string | null; size?: number; ring?: string }) {
  const initials = name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("");
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full grid place-items-center font-bold text-white ${ring ?? ""}`}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 28%))` }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="absolute inset-0 size-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initials
      )}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  // Rendered into <body> so a sheet opened from inside a blurred (backdrop-filter)
  // bar still covers the whole screen: such a bar would otherwise become the
  // containing block of the fixed overlay and squeeze it into the bar.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="sheet-up max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border-t border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/15" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-white/5" aria-label="סגור">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "h-12 w-full rounded-2xl border border-line bg-surface-2 px-4 text-base text-ink outline-none placeholder:text-muted/60 focus:border-gold/60 num";

export function Badge({ tone = "muted", children }: { tone?: "muted" | "gold" | "win" | "loss" | "warn"; children: React.ReactNode }) {
  const t = {
    muted: "bg-white/5 text-muted",
    gold: "bg-gold/15 text-gold",
    win: "bg-win/15 text-win",
    loss: "bg-loss/15 text-loss",
    warn: "bg-warn/15 text-warn",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${t}`}>{children}</span>;
}

export function Spinner() {
  return (
    <div className="grid min-h-[50dvh] place-items-center">
      <Loader2 className="size-8 animate-spin text-gold" />
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: React.ReactNode; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-gold/10 text-gold">{icon}</div>
      <div className="text-lg font-bold">{title}</div>
      {text && <p className="max-w-xs text-sm text-muted">{text}</p>}
      {children}
    </div>
  );
}

export function ChipDot({ hex, size = 18 }: { hex: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${hex} 0 46%, rgb(255 255 255 / .55) 47% 50%, ${hex} 51% 62%, transparent 63%), repeating-conic-gradient(${hex} 0 30deg, #fff 30deg 45deg)`,
        boxShadow: `0 1px 3px rgb(0 0 0 / .5)`,
      }}
    />
  );
}

export function Toast({ text, tone = "gold" }: { text: string | null; tone?: "gold" | "loss" }) {
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
      <div className={`glass rounded-2xl border px-4 py-3 text-sm font-bold ${tone === "loss" ? "border-loss/40 text-loss" : "border-gold/40 text-gold"}`}>
        {text}
      </div>
    </div>
  );
}
