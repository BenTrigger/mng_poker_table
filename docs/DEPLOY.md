# העלאה אוטומטית · pokertable.realizeaisolution.com

כל push ל-`main` מריץ את `.github/workflows/deploy.yml`, שעושה הכל לבד:
מיגרציות למסד הנתונים ב-Supabase, הגדרות התחברות (כולל Google), בנייה, והעלאה ל-Cloudflare Workers בדומיין.
אין שום פעולה ידנית בגרסאות. מגדירים את הסודות פעם אחת ושוכחים.

## הגדרה חד-פעמית

### 1. Cloudflare (טוקן)
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → Create Token → **Edit Cloudflare Workers** (תבנית) →
ב-Zone Resources לבחור `realizeaisolution.com`, ולהוסיף הרשאה `Zone · DNS · Edit` → Create.
- `CLOUDFLARE_API_TOKEN` = הטוקן
- `CLOUDFLARE_ACCOUNT_ID` = Account ID (מופיע בצד ימין בדף הבית של הדומיין)

### 2. Supabase
צור פרויקט ב-[supabase.com](https://supabase.com/dashboard) (Region: Frankfurt), ושמור את סיסמת מסד הנתונים.
- `SUPABASE_PROJECT_REF` = המזהה מכתובת הפרויקט (`https://supabase.com/dashboard/project/<REF>`)
- `SUPABASE_DB_PASSWORD` = סיסמת מסד הנתונים
- `SUPABASE_ACCESS_TOKEN` = טוקן אישי מ-[Account → Access Tokens](https://supabase.com/dashboard/account/tokens)

### 3. Google
[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) → Create credentials → OAuth client ID → Web application:
- Authorized JavaScript origins: `https://pokertable.realizeaisolution.com`
- Authorized redirect URIs: `https://<REF>.supabase.co/auth/v1/callback`

ב-OAuth consent screen: App name "All In", ואז **Publish app**.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### 4. אופציונלי
- `ANTHROPIC_API_KEY`: ספירת צ'יפים מתמונה ([console.anthropic.com](https://console.anthropic.com))

### איפה שמים
GitHub → הריפו → Settings → Secrets and variables → Actions → **New repository secret**, לכל אחד מהשמות למעלה.
אחר כך: Actions → Deploy → Run workflow (או כל push ל-`main`).

## מה הזרימה עושה

1. lint + בדיקות. אם משהו נכשל, לא עולה כלום.
2. `supabase db push`: מריץ מיגרציות חדשות מ-`supabase/migrations`.
3. מגדיר ב-Supabase: Site URL, כתובות חזרה, והתחברות Google.
4. בונה (OpenNext) ומעלה ל-Cloudflare. הדומיין מוגדר ב-`wrangler.jsonc` ו-Cloudflare יוצר DNS ותעודה לבד.
5. בודק ש-`/api/version` עונה.

## הרצה מקומית מול Cloudflare

```bash
cp .env.example .env.local   # ולמלא
npm run preview
```
