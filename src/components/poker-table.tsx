"use client";
import { Avatar } from "./ui";
import { Landmark, Plus } from "lucide-react";

export type Seat = {
  id: string;
  name: string;
  avatar?: string | null;
  amount: string; // main tag (e.g. "₪200")
  sub?: string; // second line (e.g. "2 כניסות" / "+₪40")
  tone?: "gold" | "win" | "loss" | "muted";
  isCashier?: boolean;
  isMe?: boolean;
  pending?: boolean;
  out?: boolean;
  empty?: boolean; // free seat (early sign-up)
};

/**
 * Portrait oval poker table with players seated around it.
 * Designed for phones first: the oval is taller than it is wide.
 */
export function PokerTable({ seats, center, onSeat }: { seats: Seat[]; center: React.ReactNode; onSeat?: (id: string) => void }) {
  const n = Math.max(seats.length, 1);
  return (
    <div className="relative mx-auto my-8 aspect-[3/4] w-full max-w-[400px] select-none">
      {/* rail + felt */}
      <div className="felt absolute inset-[14%_16%] rounded-[50%/38%]" />
      <div className="absolute inset-[14%_16%] grid place-items-center rounded-[50%/38%] p-6 text-center">{center}</div>

      {seats.map((s, i) => {
        // start at the bottom (the viewer's seat) and go around
        const a = Math.PI / 2 + (2 * Math.PI * i) / n;
        const x = 50 + 41 * Math.cos(a);
        const y = 50 + 42 * Math.sin(a);
        const toneCls = {
          gold: "bg-gold text-[#1d1405]",
          win: "bg-win text-[#04210f]",
          loss: "bg-loss text-white",
          muted: "bg-surface-2 text-muted",
        }[s.tone ?? "gold"];
        return (
          <button
            key={s.id}
            onClick={() => onSeat?.(s.id)}
            className={`absolute flex w-[22%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition active:scale-95 ${s.out ? "opacity-45" : ""}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <div className="relative">
              {s.empty ? (
                <div className="grid size-[46px] place-items-center rounded-full border-2 border-dashed border-gold/50 bg-black/30 text-gold">
                  <Plus className="size-5" />
                </div>
              ) : (
                <Avatar
                  name={s.name}
                  src={s.avatar}
                  size={46}
                  ring={`ring-2 ${s.isMe ? "ring-gold" : "ring-black/60"} ${s.pending ? "pulse-ring" : ""}`}
                />
              )}
              {s.isCashier && (
                <span className="absolute -bottom-1 -left-1 grid size-5 place-items-center rounded-full bg-gold text-[#1d1405] ring-2 ring-bg" title="קופאי">
                  <Landmark className="size-3" />
                </span>
              )}
            </div>
            <span className="max-w-full truncate text-[11px] font-bold leading-tight text-ink drop-shadow">{s.name}</span>
            <span className={`num rounded-full px-2 py-0.5 text-[11px] font-extrabold leading-none shadow ${toneCls}`}>{s.amount}</span>
            {s.sub && <span className="num -mt-0.5 text-[10px] text-muted">{s.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}
