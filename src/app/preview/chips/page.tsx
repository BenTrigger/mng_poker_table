"use client";
// Design preview of the chip set editor and photo learner (development only).
import { notFound } from "next/navigation";
import { ChipSetEditor } from "@/components/chip-set-editor";
import { Card } from "@/components/ui";
import { ChipCounter } from "../../t/[code]/n/[nightId]/sheets";
import { DEFAULT_CHIPS } from "@/lib/chips";

export default function ChipsPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <Card id="counter">
        <ChipCounter
          chipSet={{ id: "00000000-0000-0000-0000-000000000001", table_id: "00000000-0000-0000-0000-000000000000", name: "x", created_at: "", chips: DEFAULT_CHIPS }}
          cta="שמירת ספירה"
          onDone={(r) => console.log("done", r.total)}
        />
      </Card>
      <Card>
        <ChipSetEditor tableId="00000000-0000-0000-0000-000000000000" onSave={(n, c) => console.log("save", n, JSON.stringify(c))} />
      </Card>
    </main>
  );
}
