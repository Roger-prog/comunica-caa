import { useState } from "react";
import { ImageOff } from "lucide-react";
import type { Pictogram } from "../data/pictograms";
import type { BoardSettings } from "../lib/patientBoardModel";
import { PatientPhoto } from "./PatientPhoto";

export function PictogramPicture({
  item, size = "regular", compact = false,
}: { item: Pictogram; size?: BoardSettings["imageSize"]; compact?: boolean }) {
  const [failedUrl, setFailedUrl] = useState("");
  const fallback = <ImageOff size={20} className="text-stone-500" />;
  const pictureSize = compact ? "size-8" : {
    small: "size-12", regular: "size-16 sm:size-20", large: "size-20 sm:size-24",
  }[size];
  if (!item.imagePath && !item.imageUrl && !item.symbol) return null;
  return (
    <span
      aria-hidden="true"
      className={pictureSize + " flex max-w-full shrink-0 items-center justify-center overflow-hidden rounded-xl text-3xl"}
      style={{ backgroundColor: item.color }}
    >
      {item.imagePath ? (
        <PatientPhoto path={item.imagePath} alt="" className="size-full object-contain" fallback={fallback} />
      ) : item.imageUrl && failedUrl !== item.imageUrl ? (
        <img src={item.imageUrl} alt="" loading="lazy" decoding="async"
          referrerPolicy="no-referrer" className="size-full object-contain"
          onError={() => setFailedUrl(item.imageUrl!)} />
      ) : item.symbol ? <span>{item.symbol}</span> : fallback}
    </span>
  );
}
