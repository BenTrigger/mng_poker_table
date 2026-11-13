import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { chipSetTotal } from "@/lib/calc";
import type { Chip } from "@/lib/types";
import { checkAiQuota } from "@/lib/ai-quota";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  image: z.string().min(100), // base64, no data: prefix
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  chips: z
    .array(z.object({ color: z.string(), hex: z.string(), value: z.number(), images: z.array(z.string()).optional(), desc: z.string().optional() }))
    .min(1),
  expected: z.number().optional(),
  tableId: z.string().uuid().optional(),
  chipSetId: z.string().uuid().optional(),
});

const Result = z.object({
  stacks: z.array(z.object({ color: z.string(), count: z.number().int() })),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string(),
});

// Counting must not miss chips, so it runs on Opus at high effort by default.
const MODEL = process.env.CHIP_COUNT_MODEL || "claude-opus-5-5";

export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.ANTHROPIC_API_KEY) });
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "chip counting is not configured" }, { status: 501 });
  }
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { image, mediaType, chips, tableId, chipSetId, expected } = parsed.data;
  if (tableId) {
    const quota = await checkAiQuota(sb, tableId, "count");
    if (quota) return quota;
  }

  const palette = chips
    .map((c: Chip) => `- "${c.color}" (color ${c.hex}), value ${c.value}${c.desc ? `. Looks like: ${c.desc}` : ""}`)
    .join("\n");
  const [refs, lessons] = await Promise.all([referencePhotos(sb, chips), pastCorrections(sb, chipSetId)]);

  const client = new Anthropic();
  const instructions =
    `This photo shows stacks of poker chips, usually photographed from the side at table level.\n` +
    `The chip set has these colours:\n${palette}\n\n` +
    (refs.length ? `The reference photos above show real chips of this set (face and side views); match the chips in the photo to them.\n` : "") +
    (lessons ? `People corrected earlier automatic counts of this same chip set. Learn from these mistakes:\n${lessons}\n` : "") +
    `Work stack by stack, left to right. For every stack (or every single-colour section of a mixed stack) add one entry to "stacks" with its colour and how many chips it has. ` +
    `Count each chip edge individually from bottom to top; for tall stacks count in groups of 5 and double-check. Do not count the same chip twice, and include chips lying flat or partly hidden. ` +
    `Use exactly the colour names above. Set confidence to "low" if chips are hidden, blurry or colours are hard to tell apart (dark colours often look alike from the side), ` +
    `and explain briefly in "notes" in Hebrew, including the per-stack counts.`;
  const content: Anthropic.ContentBlockParam[] = [
    ...refs,
    ...(refs.length ? [{ type: "text" as const, text: "The photo to count:" }] : []),
    { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
    { type: "text", text: instructions },
  ];

  try {
    let out = await countOnce(client, [{ role: "user", content }]);
    if (!out) return NextResponse.json({ error: "could not count chips" }, { status: 422 });
    let tally = toCounts(out, chips);
    let recounted = false;

    // The cashier knows how much was asked for. If the photo disagrees, look once more
    // (only then, to keep the cost down) without being told to force a match.
    if (expected && tally.total !== expected) {
      const second = await countOnce(client, [
        { role: "user", content },
        { role: "assistant", content: JSON.stringify(out) },
        {
          role: "user",
          content:
            `Your count adds up to ${tally.total}, but ${expected} was expected. Look at the photo again and recount every stack chip by chip, ` +
            `paying special attention to tall stacks and to colours that look alike. If your first count was right, keep it; do not change counts just to match. ` +
            `Return the full result again.`,
        },
      ]);
      if (second) {
        out = second;
        tally = toCounts(second, chips);
        recounted = true;
      }
    }

    return NextResponse.json({
      counts: tally.counts,
      total: tally.total,
      confidence: out.confidence,
      notes: out.notes,
      recounted,
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "rate limited, try again" }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `chip counting failed (${error.status})` }, { status: 502 });
    }
    throw error;
  }
}

/** Real photos of the set's chips (learned when the set was set up), as labelled image blocks. */
async function referencePhotos(sb: Awaited<ReturnType<typeof supabaseServer>>, chips: Chip[]) {
  const blocks: Anthropic.ContentBlockParam[] = [];
  let budget = 12;
  for (const c of chips) {
    const paths = (c.images ?? []).slice(0, 2).slice(0, budget);
    if (!paths.length) continue;
    const imgs: Anthropic.ImageBlockParam[] = [];
    for (const path of paths) {
      const { data } = await sb.storage.from("chip-refs").download(path);
      if (!data) continue;
      const b64 = Buffer.from(await data.arrayBuffer()).toString("base64");
      imgs.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
    }
    if (!imgs.length) continue;
    budget -= imgs.length;
    blocks.push({ type: "text", text: `Reference: "${c.color}", value ${c.value}` }, ...imgs);
    if (budget <= 0) break;
  }
  return blocks;
}

/** The latest human fixes and notes for this chip set, as short lines for the prompt. */
async function pastCorrections(sb: Awaited<ReturnType<typeof supabaseServer>>, chipSetId?: string) {
  if (!chipSetId) return "";
  const { data } = await sb
    .from("chip_corrections")
    .select("detected, actual, note")
    .eq("chip_set_id", chipSetId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (!data?.length) return "";
  type Row = { color: string; count: number };
  return data
    .map((r: { detected: Row[] | null; actual: Row[] | null; note: string | null }) => {
      const diffs = (r.actual ?? [])
        .map((a) => ({ color: a.color, was: r.detected?.find((d) => d.color === a.color)?.count ?? 0, is: a.count }))
        .filter((d) => d.was !== d.is)
        .map((d) => `"${d.color}": counted ${d.was}, really ${d.is}`);
      const parts = [diffs.length ? diffs.join("; ") : "", r.note ? `note: ${r.note}` : ""].filter(Boolean);
      return parts.length ? `- ${parts.join(". ")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

type CountResult = z.infer<typeof Result>;

async function countOnce(client: Anthropic, messages: Anthropic.MessageParam[]): Promise<CountResult | null> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "high", format: zodOutputFormat(Result) },
    messages,
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return response.parsed_output;
}

function toCounts(out: CountResult, chips: Chip[]) {
  const counts = chips.map((c) => ({
    color: c.color,
    count: out.stacks.filter((s) => s.color === c.color).reduce((n, s) => n + Math.max(0, s.count), 0),
  }));
  return { counts, total: chipSetTotal(counts, chips) };
}
