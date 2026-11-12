# העלאה ל-Vercel · pokertable.realizeaisolutions.com

Vercel בונה ומעלה אוטומטית בכל push לענף הראשי של הריפו. כל עדכון עולה לבד, והמשתמשים רואים "גרסה חדשה זמינה".

## הגדרה חד-פעמית

### 1. Supabase
1. פרויקט חדש (Region: Frankfurt). התוכנית החינמית מספיקה.
2. מיגרציות רצות אוטומטית בכל deploy ל-production (`scripts/migrate.mjs`), דרך `POSTGRES_URL_NON_POOLING` שאינטגרציית Supabase↔Vercel מגדירה.
3. Authentication → URL Configuration:
   - Site URL: `https://pokertable.realizeaisolutions.com`
   - Redirect URLs: `https://pokertable.realizeaisolutions.com/**`, `https://*.vercel.app/**`, `http://localhost:3000/**`
4. Authentication → Providers → Google: Client ID + Secret (שלב 2).

### 2. Google OAuth
[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) → Create credentials → OAuth client ID → Web application:
- Authorized JavaScript origins: `https://pokertable.realizeaisolutions.com`
- Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`

OAuth consent screen: App name "All In" → **Publish app**.

### 3. Vercel
1. Add New → Project → Import `BenTrigger/mng_poker_table` (Framework: Next.js, בלי לשנות כלום).
2. Environment Variables (אם חיברת את Supabase דרך ה-Integration של Vercel הן כבר קיימות):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY` (אופציונלי, לספירת צ'יפים מתמונה)
3. Deploy.
4. Settings → Domains → `pokertable.realizeaisolutions.com`. Vercel יציג רשומת DNS אחת (CNAME ל-`cname.vercel-dns.com`). מוסיפים אותה ב-Cloudflare DNS של realizeaisolutions.com עם **DNS only** (ענן אפור).

### בדיקה
- `https://pokertable.realizeaisolutions.com/api/version`
- כניסה עם Google, יצירת שולחן, פתיחת ערב.
