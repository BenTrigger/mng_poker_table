/** What the photo says about a hand-over: verified, more or less than asked, or look again. */
export function verdictOf(expected: number, total: number, low: boolean): { tone: "win" | "warn"; title: string; text: string } {
  const diff = total - expected;
  if (diff === 0 && !low) return { tone: "win", title: "מאומת", text: `בתמונה ${total.toLocaleString()} צ'יפים, בדיוק כמו שביקש.` };
  if (diff === 0) return { tone: "warn", title: "שים לב", text: "הסכום תואם, אבל התמונה לא ברורה. בדוק בעין לפני האישור." };
  const more = diff > 0;
  return {
    tone: "warn",
    title: more ? `נתת יותר ב־${diff.toLocaleString()}` : `נתת פחות ב־${(-diff).toLocaleString()}`,
    text: `ביקש ${expected.toLocaleString()}, בתמונה ${total.toLocaleString()}.${low ? " התמונה לא ברורה, אולי כדאי לצלם שוב." : " תקן צבע אם הזיהוי טעה, או תקן את הערימה."}`,
  };
}
