import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { chipSetTotal } from "@/lib/calc";
import type { Chip } from "@/lib/types";
import { checkAiQuota } from "@/lib/ai-quota";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  image: z.string().min(100), // base64, no data: prefix
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  chips: z
    .array(z.object({ color: z.string(), hex: z.string(), value: z.number(), images: z.array(z.string()).optional(), desc: z.string().optional() }))
    .min(1),
  expected: z.number().optional(),
  tableId: z.string().uuid().optional(),
});

const Result = z.object({
  counts: z.array(z.object({ color: z.string(), count: z.number().int() })),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string(),
});

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
  const { image, mediaType, chips, tableId } = parsed.data;
  if (tableId) {
    const quota = await checkAiQuota(sb, tableId, "count");
    if (quota) return quota;
  }

  const palette = chips
    .map((c: Chip) => `- "${c.color}" (color ${c.hex}), value ${c.value}${c.desc ? `. Looks like: ${c.desc}` : ""}`)
    .join("\n");
  const refs = await referencePhotos(sb, chips);

  const client = new Anthropic();
  try {
    const response = await client.messages.parse({
      // counting runs many times a night, so it uses the cheaper model; learning a set uses Opus
      model: process.env.CHIP_COUNT_MODEL || "claude-sonnet-5-5",
      max_tokens: 16000,
      output_config: { effort: "high", format: zodOutputFormat(Result) },
      messages: [
        {
          role: "user",
          content: [
            ...refs,
            ...(refs.length ? [{ type: "text" as const, text: "The photo to count:" }] : []),
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            {
              type: "text",
              text:
                `This photo shows one or more stacks of poker chips, usually photographed from the side.\n` +
                `Count how many chips of each colour are in the photo. The chip set has these colours:\n${palette}\n\n` +
                (refs.length ? `The reference photos above show real chips of this set (face and side views); match the chips in the photo to them.\n` : "") +
                `Stacks are often lined up side by side in a row. Count edge stripes carefully, stack by stack, then add them up. Use exactly the colour names above in "counts", ` +
                `one entry per colour (count 0 if absent). Set confidence to "low" if chips are hidden, blurry, ` +
                `or colours are hard to tell apart, and explain briefly in "notes" (in Hebrew).`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return NextResponse.json({ error: "could not count chips" }, { status: 422 });
    }
    const out = response.parsed_output;
    const counts = chips.map((c) => ({
      color: c.color,
      count: Math.max(0, out.counts.find((x) => x.color === c.color)?.count ?? 0),
    }));
    return NextResponse.json({
      counts,
      total: chipSetTotal(counts, chips),
      confidence: out.confidence,
      notes: out.notes,
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
