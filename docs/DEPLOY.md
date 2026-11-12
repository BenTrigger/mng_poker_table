# העלאה ל-Cloudflare · pokertable.realizeaisolution.com

האפליקציה רצה כ-Cloudflare Worker (Next.js דרך OpenNext). Cloudflare בונה ומעלה אוטומטית בכל מיזוג ל-`main`, כך שכל עדכון מגיע למשתמשים לבד.

## פעם אחת: Supabase

1. צור פרויקט ב-[supabase.com](https://supabase.com) (אזור: Frankfurt, הכי קרוב לישראל).
2. SQL Editor → הדבק והרץ את `supabase/migrations/0001_init.sql`.
3. Authentication → URL Configuration:
   - Site URL: `https://pokertable.realizeaisolution.com`
   - Redirect URLs: `https://pokertable.realizeaisolution.com/**` ו-`http://localhost:3000/**`
4. Authentication → Providers → Google: הדבק Client ID ו-Secret (שלב הבא).
5. Project Settings → API: העתק את `Project URL` ואת `anon public key`.

## פעם אחת: Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Create credentials → OAuth client ID → Web application.
2. Authorized JavaScript origins: `https://pokertable.realizeaisolution.com`
3. Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`
4. OAuth consent screen: שם האפליקציה "All In", ולפרסם (Publish) כדי שכל משתמש גוגל יוכל להיכנס.

## פעם אחת: Cloudflare

הדומיין `realizeaisolution.com` צריך להיות באותו חשבון Cloudflare.

1. Workers & Pages → Create → **Import a repository** → בחר את `BenTrigger/mng_poker_table`.
2. הגדרות בנייה:
   - Build command: `npx opennextjs-cloudflare build`
   - Deploy command: `npx opennextjs-cloudflare deploy`
   - Production branch: `main`
3. Settings → Variables and secrets. להוסיף גם ב-**Build variables** וגם ב-**Variables** (runtime):
   | שם | ערך |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | ה-Project URL מ-Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ה-anon key |
   | `ANTHROPIC_API_KEY` (Secret, runtime בלבד) | אופציונלי, לספירת צ'יפים מתמונה |
   | `NEXT_PUBLIC_APK_URL` (Build) | אופציונלי, קישור ל-APK |
4. Deploy. הדומיין `pokertable.realizeaisolution.com` מוגדר ב-`wrangler.jsonc` ו-Cloudflare יוצר לו DNS ותעודה לבד.

## בדיקה אחרי העלאה

- `https://pokertable.realizeaisolution.com/api/version` מחזיר את הגרסה.
- כניסה עם גוגל, יצירת שולחן, פתיחת ערב.

## מקומית מול Cloudflare

```bash
cp .env.example .env.local   # ולמלא
npm run preview              # בונה ומריץ את ה-Worker מקומית
```
