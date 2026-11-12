/**
 * Release notes shown to users in "מה חדש".
 * For every release: bump "version" in package.json and add an entry at the TOP.
 */
export type Release = { version: string; date: string; title: string; items: string[] };

export const CHANGELOG: Release[] = [
  {
    version: "1.1.0",
    date: "2026-11-12",
    title: "החלפת קופאי באמצע ערב",
    items: [
      "הקופאי צריך ללכת? בוחרים קופאי חדש, סופרים את הערימות מתמונה ומעבירים את הקופה",
      "בדיקת חוסרים בהחלפה: כמה חולק מול כמה נספר על השולחן",
      "הקופאי היוצא יכול גם לקום מהשולחן באותה פעולה, והחשבון שלו נסגר",
      "אפשר לספור ולתעד גם את הצ'יפים שנשארו בקופה",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-12",
    title: "השקה 🎉",
    items: [
      "שולחנות עם קוד קבוע וכניסה עם Google",
      "קופאי לכל ערב: בקשות צ'יפים, מסירה עם צילום הוכחה",
      "ספירת צ'יפים מתמונה לפי צבעים",
      "סגירת ערב עם מי מעביר למי ושיתוף לוואטסאפ",
      "סטטיסטיקות, טבלת שולחן ותארים",
    ],
  },
];

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
export const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "dev";

/** -1 if a < b, 0 if equal, 1 if a > b (semver, numbers only). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Releases newer than `seen` (all of them if nothing was seen yet). */
export function releasesSince(seen: string | null): Release[] {
  if (!seen) return CHANGELOG.slice(0, 1);
  return CHANGELOG.filter((r) => compareVersions(r.version, seen) > 0);
}
