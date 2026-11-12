import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { checkAiQuota } from "@/lib/ai-quota";

export const runtime = "nodejs";
export const maxDuration = 60;

// Learns a chip set from photos: finds each distinct chip type, where it is in
// each photo (so the client can crop a real picture of it), and its value when
// the value is printed on the chip.
const Body = z.object({
  tableId: z.string().uuid(),
  photos: z
    .array(
      z.object({
        image: z.string().min(100), // base64, no data: prefix
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(5),
});

const Result = z.object({
  types: z.array(
    z.object({
      name: z.string(),
      hex: z.string(),
      printed_value: z.number().nullable(),
      suggested_value: z.number().nullable(),
      description: z.string(),
      crops: z.array(
        z.object({
          photo: z.number().int(),
          view: z.enum(["top", "side"]),
          x0: z.number(),
          y0: z.number(),
          x1: z.number(),
          y1: z.number(),
        }),
      ),
    }),
  ),
  notes: z.string(),
});

const PROMPT = (sizes: string) => `These photos show the poker chips of one chip set. The user is teaching an app what each chip type looks like, so that later the app can count chips in photos of stacks.
Photos (numbered from 0), with their size in pixels:
${sizes}

Find every DISTINCT chip type (a chip type = one design/colour/denomination). The same type may appear several times, in several photos, and from different angles (face up, tilted, or from the side in a stack). Merge them into one type.

For each type return:
- name: a short Hebrew colour name a person would use, e.g. "אדום", "כחול", "שחור", "לבן", "ירוק", "צהוב", "סגול", "ורוד", "כתום". If two types share a main colour, add a distinguishing word, e.g. "כחול בהיר".
- hex: the chip's main colour as #rrggbb.
- printed_value: the number printed on the chip face, if you can actually read it. null if nothing is printed or it is not readable. Never guess here.
- suggested_value: when printed_value is null, a plausible value from common home-game conventions (white 1, red 5, blue 10, green 25, black 100, purple 500, yellow/orange 1000). null if no reasonable guess.
- description: one short English sentence describing the face and especially the EDGE as seen from the side (stripe pattern, number and colour of edge spots/inserts), to tell this type apart in side-view stacks.
- crops: up to 3 boxes showing this chip type, each tightly around ONE chip, in pixel coordinates of that photo (x0,y0 top-left, x1,y1 bottom-right). Prefer: one clear face-up chip (view "top"), and if available one from the side (view "side"; for a stack, box a short section of the stack made only of this type, or the single chip edge). Boxes must be inside the photo.

Do not invent chip types that are not visible. Put any problem (blur, glare, hidden chips, types that look almost the same) in "notes", in Hebrew, briefly.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "chip recognition is not configured" }, { status: 501 });
  }
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { photos, tableId } = parsed.data;
  const quota = await checkAiQuota(sb, tableId, "learn");
  if (quota) return quota;

  const sizes = photos.map((p, i) => `- photo ${i}: ${p.width}x${p.height}`).join("\n");
  const content: Anthropic.ContentBlockParam[] = [];
  photos.forEach((p, i) => {
    content.push({ type: "text", text: `Photo ${i}:` });
    content.push({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.image } });
  });
  content.push({ type: "text", text: PROMPT(sizes) });

  const client = new Anthropic();
  try {
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "high", format: zodOutputFormat(Result) },
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return NextResponse.json({ error: "could not recognise chips" }, { status: 422 });
    }
    return NextResponse.json(normalise(response.parsed_output, photos));
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "rate limited, try again" }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `chip recognition failed (${error.status})` }, { status: 502 });
    }
    throw error;
  }
}

function normalise(out: z.infer<typeof Result>, photos: { width: number; height: number }[]) {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
  const positive = (v: number | null) => (v != null && Number.isFinite(v) && v > 0 ? v : null);
  const types = out.types
    .map((t) => ({
      name: t.name.trim() || "צ'יפ",
      hex: /^#[0-9a-f]{6}$/i.test(t.hex) ? t.hex.toLowerCase() : "#888888",
      value: positive(t.printed_value),
      suggested: positive(t.suggested_value),
      desc: t.description.trim(),
      crops: t.crops
        .filter((c) => photos[c.photo])
        .map((c) => {
          const { width: w, height: h } = photos[c.photo];
          const box: [number, number, number, number] = [
            clamp(Math.min(c.x0, c.x1), w), clamp(Math.min(c.y0, c.y1), h),
            clamp(Math.max(c.x0, c.x1), w), clamp(Math.max(c.y0, c.y1), h),
          ];
          return { photo: c.photo, view: c.view, box };
        })
        .filter((c) => c.box[2] - c.box[0] >= 8 && c.box[3] - c.box[1] >= 8)
        .slice(0, 3),
    }))
    .filter((t) => t.crops.length > 0);
  // unique names
  const seen = new Map<string, number>();
  for (const t of types) {
    const n = (seen.get(t.name) ?? 0) + 1;
    seen.set(t.name, n);
    if (n > 1) t.name = `${t.name} ${n}`;
  }
  return { types, notes: out.notes };
}
