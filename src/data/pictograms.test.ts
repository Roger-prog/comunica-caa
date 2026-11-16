import { describe, expect, it } from "vitest";
import source from "./board-vocabulary.source.json";
import {
  CATALOG_PICTOGRAMS, DEFAULT_HOME_SYMBOL_IDS, HEALTH_CATEGORIES,
  PICTOGRAMS, searchPictograms,
} from "./pictograms";

describe("catálogo da prancha", () => {
  it("preserva as três páginas e todos os termos das 17 categorias de origem", () => {
    expect(source.pages).toBe(3);
    expect(source.groups).toHaveLength(17);
    expect(source.groups.reduce((count, group) => count + group.words.length, 0)).toBe(356);
    for (const { category, words } of source.groups) {
      const labels = new Set(CATALOG_PICTOGRAMS
        .filter((item) => item.sourceCategories?.includes(category))
        .map((item) => item.label));
      expect(labels, category).toEqual(new Set(words));
    }
  });

  it("agrupa termos repetidos sem mesclar grafias ou sentidos distintos", () => {
    expect(new Set(CATALOG_PICTOGRAMS.map(({ id }) => id)).size).toBe(CATALOG_PICTOGRAMS.length);
    expect(CATALOG_PICTOGRAMS.filter(({ label }) => label === "Pular")).toHaveLength(1);
    expect(CATALOG_PICTOGRAMS.find(({ label }) => label === "Um")?.sourceCategories)
      .toEqual(["Apontar e Quantidade", "Números, ordem e fases"]);
    expect(CATALOG_PICTOGRAMS.filter(({ label }) => label === "Quarto").map(({ id }) => id))
      .toEqual(["quarto", "quarto-ordinal"]);
    expect(CATALOG_PICTOGRAMS.find(({ id }) => id === "e")?.label).toBe("E");
    expect(CATALOG_PICTOGRAMS.find(({ id }) => id === "e-verbo")?.label).toBe("É");
    expect(CATALOG_PICTOGRAMS.find(({ label }) => label === "Quer")?.id).toBe("quer");
  });

  it("mantém os identificadores históricos e a vitrine inicial reduzida", () => {
    const current = new Map(CATALOG_PICTOGRAMS.map((item) => [item.id, item]));
    for (const previous of PICTOGRAMS) {
      expect(current.get(previous.id)).toMatchObject({
        category: previous.category,
        label: previous.label,
      });
    }
    expect(DEFAULT_HOME_SYMBOL_IDS).toHaveLength(12);
    expect(DEFAULT_HOME_SYMBOL_IDS.every((id) => current.has(id))).toBe(true);
    expect(current.get("agua")?.imageUrl).toBe("/api/arasaac-image?id=2248");
    expect(current.get("quarto-ordinal")).toMatchObject({ source: "text", reviewStatus: "pending" });
    expect(current.get("quarto-ordinal")?.imageUrl).toBeUndefined();
  });

  it("encontra palavras dos diferentes grupos, reconhece sinônimos e separa fala clínica", () => {
    expect(searchPictograms(CATALOG_PICTOGRAMS, "mAe").map(({ id }) => id))
      .toEqual(expect.arrayContaining(["mae", "mamae"]));
    expect(searchPictograms(CATALOG_PICTOGRAMS, "beber").map(({ id }) => id).slice(0, 2))
      .toEqual(["beber", "agua"]);
    expect(searchPictograms(CATALOG_PICTOGRAMS, "machucado").map(({ id }) => id))
      .toEqual(expect.arrayContaining(["dor", "ferimento"]));
    for (const category of HEALTH_CATEGORIES) {
      expect(CATALOG_PICTOGRAMS.some((item) => item.categories?.includes(category))).toBe(true);
    }
    expect(CATALOG_PICTOGRAMS.find(({ id }) => id === "dor")?.privateSpeech).toBe(true);
    expect(CATALOG_PICTOGRAMS.find(({ id }) => id === "agora")?.privateSpeech).toBe(false);
  });
});
