import type { Chip } from "./types";

/** Folds the confirmed learned chips into an existing list: same value -> same chip (photos added), else a new chip. */
export function mergeLearned<T extends Chip & { newImages?: Blob[] }>(current: T[], learned: (Chip & { newImages: Blob[] })[], replace: boolean): T[] {
  if (replace) return learned as T[];
  const out = current.map((c) => ({ ...c }));
  for (const l of learned) {
    const i = out.findIndex((c) => c.value === l.value);
    if (i >= 0) {
      const c = out[i];
      out[i] = {
        ...c,
        hex: l.hex,
        desc: l.desc || c.desc,
        newImages: [...(c.newImages ?? []), ...l.newImages],
      };
    } else {
      let name = l.color;
      let n = 2;
      while (out.some((c) => c.color === name)) name = `${l.color} ${n++}`;
      out.push({ ...l, color: name } as T);
    }
  }
  return out;
}
