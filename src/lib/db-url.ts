/**
 * Drops sslmode from the URL (we set ssl ourselves). Uses URL parsing so the
 * other params survive: the Supabase pooler URL is "...?sslmode=require&supa=...",
 * and a plain regex left "postgres&supa=..." as the database name.
 */
export function withoutSslMode(url: string) {
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return url;
  }
}
