import { MapPin, Navigation } from "lucide-react";
import { wazeUrl, type LatLng } from "@/lib/waze";

/** Host and address of a night or tournament, with a "navigate in Waze" button when there is an address */
export function PlaceInfo({ host, address, at }: { host: string | null; address?: string | null; at?: LatLng | null }) {
  if (!host && !address) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
      <MapPin className="size-5 shrink-0 text-gold" />
      <div className="min-w-0 flex-1">
        {host && <div className="truncate font-bold">{host}</div>}
        {address && <div className="truncate text-sm text-muted">{address}</div>}
      </div>
      {address && (
        <a
          href={wazeUrl(address, at)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-2xl bg-[#33ccff] px-3 py-2 text-sm font-extrabold text-[#06222b]"
        >
          <Navigation className="size-4" /> ניווט בוויז
        </a>
      )}
    </div>
  );
}
