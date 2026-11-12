# APK לאנדרואיד

אחרי שהאתר עלה ל-`https://pokertable.realizeaisolutions.com`:

1. נכנסים ל-[pwabuilder.com](https://www.pwabuilder.com), מדביקים את הכתובת → Package for stores → Android.
2. Package ID: `com.realizeaisolution.pokertable`. אפשר להשאיר את שאר ההגדרות.
3. מורידים את ה-zip. בפנים יש `app-release-signed.apk`, קובץ `signing.keystore` עם הסיסמאות שלו, ו-`assetlinks.json`.
   **את ה-keystore והסיסמאות שומרים במקום בטוח.** בלעדיהם אי אפשר לעדכן את ה-APK.
4. מתוך `assetlinks.json` מעתיקים את `sha256_cert_fingerprints` ושמים ב-Cloudflare משתנה `ANDROID_CERT_SHA256` (כמה ערכים מפרידים בפסיק). זה מה שגורם לאפליקציה להיפתח במסך מלא בלי שורת כתובת.
5. מעלים את ה-APK לאיזה אחסון ציבורי (למשל R2 או Google Drive עם קישור ציבורי) ושמים את הקישור ב-`NEXT_PUBLIC_APK_URL`. כפתור "הורדת APK" יופיע בעמוד `/install` במכשירי אנדרואיד.

אייפון לא מתקין APK: שם מתקינים מ-Safari דרך "הוסף למסך הבית", והעמוד `/install` מסביר את זה.
