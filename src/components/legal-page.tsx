import Link from "next/link";

export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { h: string; p: string[] }[] }) {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 pb-16 leading-relaxed">
      <header className="space-y-1">
        <Link href="/" className="text-sm text-muted">← PokerTable</Link>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-extrabold">{title}</h1>
        <p className="text-xs text-muted">עודכן לאחרונה: {updated}</p>
      </header>
      {sections.map((s) => (
        <section key={s.h} className="space-y-2">
          <h2 className="text-lg font-bold">{s.h}</h2>
          {s.p.map((t, i) => (
            <p key={i} className="text-sm text-muted">{t}</p>
          ))}
        </section>
      ))}
      <footer className="flex gap-4 border-t border-line pt-4 text-xs text-muted">
        <Link href="/privacy">מדיניות פרטיות</Link>
        <Link href="/terms">תנאי שימוש</Link>
      </footer>
    </main>
  );
}
