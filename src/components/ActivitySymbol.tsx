import { CATALOG_PICTOGRAMS, type Pictogram } from "../data/pictograms";
import { eventType } from "../lib/activityEvents";
import { getArasaacImageUrl } from "../lib/arasaacPaths";
import type { Comunicacao } from "../lib/database.types";
import { PictogramPicture } from "./PictogramPicture";

const officialSymbols = new Map(CATALOG_PICTOGRAMS.map((item) => [item.id, item]));

export function ActivitySymbol({ event, catalog }: {
  event: Comunicacao;
  catalog?: ReadonlyMap<string, Pictogram>;
}) {
  if (eventType(event) === "message_playback" || !event.pictograma_id) return null;
  const isCustom = event.symbol_source === "custom";
  const current = catalog?.get(event.pictograma_id)
    ?? (isCustom ? undefined : officialSymbols.get(event.pictograma_id));
  const snapshot = event.arasaac_id ? getArasaacImageUrl(event.arasaac_id) : "";
  if (!snapshot && !current?.imagePath && !current?.imageUrl) return null;
  // Only current authorized symbols supply private photo paths. The historical
  // public ARASAAC ID takes precedence if this symbol subsequently changes.
  const item: Pictogram = {
    id: event.pictograma_id,
    label: event.rotulo,
    category: event.categoria ?? "",
    color: current?.color ?? "#efebf9",
    symbol: "",
    imagePath: snapshot ? undefined : current?.imagePath,
    imageUrl: snapshot || current?.imageUrl,
  };
  return <PictogramPicture item={item} compact />;
}
