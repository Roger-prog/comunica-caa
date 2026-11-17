import { CATALOG_PICTOGRAMS, getCategoryLabel, type Pictogram } from "../data/pictograms";
import { getArasaacImageUrl } from "./arasaac";
import type { PatientBoard } from "./patientBoard";

export function applyPatientBoard(board: PatientBoard | null, includeHidden = false): readonly Pictogram[] {
  if (!board) return CATALOG_PICTOGRAMS;
  const overrides = new Map(board.overrides.map((item) => [item.symbol_id, item.arasaac_id]));
  const base = CATALOG_PICTOGRAMS.map((item) => {
    const id = overrides.get(item.id);
    return id ? { ...item, arasaacId: id, imageUrl: getArasaacImageUrl(id), source: "arasaac" as const }
      : item;
  });
  const custom: Pictogram[] = board.symbols.filter((item) => includeHidden || !item.hidden).map((item) => {
    const categories = item.categories.map(getCategoryLabel);
    return {
      id: item.id,
      label: item.label,
      spokenText: item.speech_text,
      category: categories[0] ?? "Meus símbolos",
      categories,
      source: "custom",
      privateSpeech: true,
      imagePath: item.image_path ?? undefined,
      imageUrl: item.arasaac_id ? getArasaacImageUrl(item.arasaac_id) : undefined,
      arasaacId: item.arasaac_id ?? undefined,
      color: "#f4effb",
      symbol: "",
    };
  });
  return [...base, ...custom];
}
