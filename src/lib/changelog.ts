/**
 * Release notes shown to users in "מה חדש".
 * For every release: bump "version" in package.json and add an entry at the TOP.
 */
export type Release = { version: string; date: string; title: string; items: string[] };

export const CHANGELOG: Release[] = [
  {
    version: "1.3.2",
    date: "2026-11-12",
    title: "התקנה מהירה וניהול שחקנים בערב",
    items: [
      "פס התקנה מעל התפריט: באנדרואיד מתקינים בלחיצה, באייפון מקבלים הדרכה קצרה",
      "כפתור \"שחקנים וקופאי\" במסך הערב: מינוי קופאי גם באמצע המשחק",
      "הוספת שחקן באמצע הערב, גם שחקן חדש לפי שם",
      "הסרת שחקן שעוד לא קיבל צ'יפים, או יציאה ופדיון למי שכבר שיחק",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-11-12",
    title: "תיקונים ואבטחה",
    items: [
      "יצירת שולחן חדש עובדת שוב",
      "רק חברי השולחן יכולים להוסיף בקשות צ'יפים לערב שלו",
      "רק המנהל יכול לשנות סכום או צדדים בהעברה, ומי שמקבל את הכסף מסמן ששולם",
      "דפי מדיניות פרטיות ותנאי שימוש",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-11-12",
    title: "התחשבנות ופרטיות תוצאות",
    items: [
      "בסוף ערב בוחרים: חלוקה אוטומטית עם מינימום העברות, או הכל דרך הקופאי",
      "הגדרה למנהל: כולם רואים את כל התוצאות, או כל אחד רואה רק את שלו",
      "כשכל אחד רואה רק את שלו, המנהל רואה הכל ויכול לשתף את הסיכום בוואטסאפ",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-11-12",
    title: "הרשמה מוקדמת לערב",
    items: [
      "המנהל פותח הרשמה לערב הבא: תאריך, שעה, מקום ומספר מקומות",
      "שיתוף בוואטסאפ עם רשימת הרשומים וכמה מקומות נשארו",
      "כל אחד תופס כיסא בשולחן עד שמתמלא, ואחר כך נכנסים לרשימת המתנה שעולה אוטומטית",
      "פותחים את הערב ישר מההרשמה, עם השחקנים לפי המקומות שלהם",
    ],
  },
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
