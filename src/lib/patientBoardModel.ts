export type BoardSettings = {
  columns: number;
  cardSize: "compact" | "regular" | "large";
  imageSize: "small" | "regular" | "large";
  labelSize: "regular" | "large" | "extra";
  spacing: "compact" | "regular" | "loose";
  contrast: boolean;
  pageSize: number;
  enabledCategories: string[] | null;
  categoryOrder: string[];
  favoriteCategories: string[];
  favorites: string[];
  homeSymbols: string[] | null;
  symbolOrder: Record<string, string[]>;
  voiceURI: string;
  rate: number;
};

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  columns: 4,
  cardSize: "regular",
  imageSize: "regular",
  labelSize: "regular",
  spacing: "regular",
  contrast: false,
  pageSize: 12,
  enabledCategories: null,
  categoryOrder: [],
  favoriteCategories: [],
  favorites: [],
  homeSymbols: null,
  symbolOrder: {},
  voiceURI: "",
  rate: 1,
};

export type BoardSettingsRow = {
  crianca_id: string;
  settings: BoardSettings;
  version: number;
  updated_at: string;
};

export type CustomSymbol = {
  id: string;
  crianca_id: string;
  created_by: string | null;
  label: string;
  speech_text: string;
  categories: string[];
  arasaac_id: number | null;
  image_path: string | null;
  source: "arasaac" | "personalizado";
  hidden: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type CatalogOverride = {
  crianca_id: string;
  symbol_id: string;
  arasaac_id: number;
  updated_at: string;
  reviewed_by: string | null;
};

export type PatientBoard = {
  settings: BoardSettings;
  settingsVersion: number;
  symbols: CustomSymbol[];
  overrides: CatalogOverride[];
};

export function normalizeBoardSettings(value: Partial<BoardSettings>): BoardSettings {
  const source = value && typeof value === "object" ? value : {};
  const strings = (list: unknown, limit: number): string[] =>
    Array.isArray(list)
      ? [...new Set(list.filter((item): item is string => typeof item === "string" && !!item && item.length <= 120))].slice(0, limit)
      : [];
  const integer = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  const option = <T extends string>(input: unknown, list: readonly T[], fallback: T): T =>
    list.find((item) => input === item) ?? fallback;
  const order = source.symbolOrder && typeof source.symbolOrder === "object" && !Array.isArray(source.symbolOrder)
    ? Object.fromEntries(Object.entries(source.symbolOrder).slice(0, 48).map(([key, ids]) => [key.slice(0, 120), strings(ids, 512)]))
    : {};
  return {
    columns: integer(source.columns, 2, 6, 4),
    cardSize: option(source.cardSize, ["compact", "regular", "large"], "regular"),
    imageSize: option(source.imageSize, ["small", "regular", "large"], "regular"),
    labelSize: option(source.labelSize, ["regular", "large", "extra"], "regular"),
    spacing: option(source.spacing, ["compact", "regular", "loose"], "regular"),
    contrast: source.contrast === true,
    pageSize: integer(source.pageSize, 4, 36, 12),
    enabledCategories: Array.isArray(source.enabledCategories) ? strings(source.enabledCategories, 48) : null,
    categoryOrder: strings(source.categoryOrder, 48),
    favoriteCategories: strings(source.favoriteCategories, 48),
    favorites: strings(source.favorites, 256),
    homeSymbols: Array.isArray(source.homeSymbols) ? strings(source.homeSymbols, 36) : null,
    symbolOrder: order,
    voiceURI: option(source.voiceURI, ["", "pt-BR-FranciscaNeural", "pt-BR-AntonioNeural"], ""),
    rate: typeof source.rate === "number" && source.rate >= 0.5 && source.rate <= 1.5 ? source.rate : 1,
  };
}
