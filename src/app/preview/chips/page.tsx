"use client";
// Design preview of the chip set editor and photo learner (development only).
import { notFound } from "next/navigation";
import { ChipSetEditor } from "@/components/chip-set-editor";
import { Card } from "@/components/ui";

export default function ChipsPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-lg p-4">
      <Card>
        <ChipSetEditor tableId="00000000-0000-0000-0000-000000000000" onSave={(n, c) => console.log("save", n, JSON.stringify(c))} />
      </Card>
    </main>
  );
}
