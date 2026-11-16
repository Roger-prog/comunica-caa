import { getArasaacImageUrl } from "../lib/arasaacPaths";
import generatedCatalog from "./board-catalog.generated.json";
import legacyPictograms from "./legacy-pictograms.json";

export interface Pictogram {
  id: string;
  label: string;
  symbol: string;
  category: string;
  color: string;
  categories?: readonly string[];
  sourceCategories?: readonly string[];
  spokenText?: string;
  source?: "arasaac" | "text" | "custom";
  arasaacId?: number;
  imageUrl?: string;
  imagePath?: string;
  reviewStatus?: "verified" | "pending";
  relatedTerms?: readonly string[];
  privateSpeech?: boolean;
}

// The original inventory still defines the public audio asset manifest.
export const PICTOGRAMS: Pictogram[] = legacyPictograms;
export const CATEGORIES = [...new Set(PICTOGRAMS.map((item) => item.category))];

const colors = ["#eaf3fb", "#fff0e5", "#efebf9", "#fff3d8", "#eaf4ed", "#fbecef"];
const originalById = new Map(legacyPictograms.map((item) => [item.id, item]));

export const CATALOG_CATEGORIES = [
  ...new Set(generatedCatalog.flatMap((item) => item.categories)),
];

export function normalizeVocabularyText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim()
    .replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function toCategoryId(category: string): string {
  return normalizeVocabularyText(category).replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const CATEGORY_OPTIONS = CATALOG_CATEGORIES.map((label) => ({
  id: toCategoryId(label),
  label,
}));

const labelsByCategoryId = new Map(CATEGORY_OPTIONS.map(({ id, label }) => [id, label]));

export function getCategoryLabel(id: string): string {
  return labelsByCategoryId.get(id) ?? id;
}

export const HEALTH_CATEGORIES = [
  "Sintomas", "Partes do corpo", "Intensidade", "Tempo dos sintomas",
  "Atendimento", "Comunicação durante a consulta",
];

export const ESSENTIAL_PICTOGRAM_IDS = [
  "eu", "voce", "sim", "nao", "mais", "ajuda",
  "querer", "precisar", "parar", "ir", "fazer", "agora",
];

export const NEEDS_PICTOGRAM_IDS = [
  "agua", "comer", "banheiro", "descansar", "ajuda", "dormir",
];

export const DEFAULT_HOME_SYMBOL_IDS = [
  ...NEEDS_PICTOGRAM_IDS, "eu", "voce", "sim", "nao", "mais", "ola",
];

export const CATALOG_PICTOGRAMS: Pictogram[] = generatedCatalog.map((item) => {
  const original = originalById.get(item.id);
  const arasaacId = "arasaacId" in item ? item.arasaacId : undefined;
  const colorIndex = CATALOG_CATEGORIES.indexOf(item.category) % colors.length;
  return {
    id: item.id,
    label: item.label,
    symbol: "", // The visible label is the accessible fallback while awaiting review.
    category: item.category,
    categories: item.categories,
    sourceCategories: item.sourceCategories,
    spokenText: item.speechText,
    source: arasaacId ? "arasaac" : "text",
    reviewStatus: arasaacId ? "verified" : "pending",
    arasaacId,
    imageUrl: arasaacId ? getArasaacImageUrl(arasaacId) : undefined,
    relatedTerms: item.relatedTerms,
    color: original?.color ?? colors[colorIndex],
    privateSpeech: item.id !== "agora" && item.id !== "sempre"
      && item.categories.some((category) => HEALTH_CATEGORIES.includes(category)),
  };
});

export function getPictogramSpeech(pictogram: Pictogram): string {
  return pictogram.spokenText?.trim() || pictogram.label;
}

export function searchPictograms(items: readonly Pictogram[], query: string): Pictogram[] {
  const term = normalizeVocabularyText(query);
  if (!term) return [...items];

  return items.flatMap((item) => {
    const label = normalizeVocabularyText(item.label);
    if (label === term) return [{ item, score: 4 }];
    if (label.startsWith(term)) return [{ item, score: 3 }];
    if (term.length >= 2 && label.includes(term)) return [{ item, score: 2 }];
    if (item.relatedTerms?.some((related) => {
      const alias = normalizeVocabularyText(related);
      return alias === term || (term.length >= 3 && alias.startsWith(term));
    })) return [{ item, score: 1 }];
    return [];
  }).sort((left, right) => right.score - left.score).map(({ item }) => item);
}
