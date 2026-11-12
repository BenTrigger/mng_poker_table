"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Avatar } from "./ui";

export function TopBar({ title, back, sub, avatar, right }: { title: string; back?: string; sub?: string; avatar?: { name: string; src?: string | null }; right?: React.ReactNode }) {
  return (
    <header className="glass sticky top-0 z-30 border-b border-line px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex max-w-lg items-center gap-3">
        {back && (
          <Link href={back} className="-mr-2 rounded-full p-2 text-muted hover:bg-white/5" aria-label="חזרה">
            <ChevronRight className="size-6" />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-[family-name:var(--font-display)] text-lg font-extrabold leading-tight">{title}</h1>
          {sub && <div className="truncate text-xs text-muted">{sub}</div>}
        </div>
        {right}
        {avatar && <Avatar name={avatar.name} src={avatar.src} size={34} />}
      </div>
    </header>
  );
}
