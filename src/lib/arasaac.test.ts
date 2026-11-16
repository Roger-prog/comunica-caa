import { afterEach, describe, expect, it, vi } from "vitest";
import { searchArasaac } from "./arasaac";
import { handleArasaacImage, handleArasaacSearch } from "./arasaacProxy";

const sameOrigin = "https://example.invalid";
const search = (term: string) => new Request(
  `${sameOrigin}/api/arasaac-search?${new URLSearchParams({ q: term })}`,
);

afterEach(() => vi.unstubAllGlobals());

describe("integração ARASAAC", () => {
  it("restringe a pesquisa ao vocabulário público antes de fazer qualquer requisição", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchArasaac("Nome Fictício de Paciente Silva")).rejects.toThrow("vocabulário público");
    expect((await handleArasaacSearch(search("Nome Fictício de Paciente Silva"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("evita duas buscas iguais em andamento e reutiliza a resposta", async () => {
    const fetchMock = vi.fn(async () => Response.json([{ id: 2248, labels: ["água"] }]));
    vi.stubGlobal("fetch", fetchMock);
    const [first, second] = await Promise.all([searchArasaac("Água"), searchArasaac("  AGUA ")]);
    expect(first).toEqual([{ id: 2248, labels: ["água"], imageUrl: "/api/arasaac-image?id=2248" }]);
    expect(second).toEqual(first);
    expect(await searchArasaac("água")).toEqual(first);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/arasaac-search?q=%C3%81gua",
      expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }));
  });

  it("encaminha só o termo canônico e filtra campos externos e resultados duplicados", async () => {
    const fetchMock = vi.fn(async () => Response.json([
      { _id: 2372, keywords: [{ keyword: "elefante" }], tags: ["animal"] },
      { _id: 2372, keywords: [{ keyword: "Duplicata" }] },
      { _id: 180, keywords: [{ keyword: "Exemplo" }], violence: true },
      { _id: "2351", keywords: [] },
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleArasaacSearch(search(" ELEFANTE "));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 2372, labels: ["elefante"] }]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://api.arasaac.org/v1/pictograms/pt/search/Elefante",
      expect.objectContaining({
        credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("diferencia catálogo vazio de indisponibilidade da API", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([], { status: 404 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json([{ id: 2490, labels: ["pássaro"] }]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await (await handleArasaacSearch(search("Paciente"))).json()).toEqual({ error: "arasaac_unavailable" });
    const empty = await handleArasaacSearch(search("Pássaro"));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
    await expect(searchArasaac("Pássaro")).rejects.toThrow("Verifique a conexão");
    expect(await searchArasaac("Pássaro")).toHaveLength(1);
  });

  it("valida identificador e tipo de imagem antes de servir mídia pelo domínio do Comunica", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("<html>indisponível</html>", {
        headers: { "Content-Type": "text/html" },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        headers: { "Content-Type": "image/png" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const image = (id: string) => handleArasaacImage(
      new Request(`${sameOrigin}/api/arasaac-image?${new URLSearchParams({ id })}`),
    );
    expect((await image("https://imagem.exemplo/")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await image("2372")).status).toBe(502);
    const response = await image("2372");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(fetchMock).toHaveBeenLastCalledWith("https://static.arasaac.org/pictograms/2372/2372_500.png",
      expect.objectContaining({ credentials: "omit", redirect: "error" }));
  });
});
