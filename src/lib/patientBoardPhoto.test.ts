import { File } from "node:buffer";
import { describe, expect, it } from "vitest";
import { prepareBoardPhoto, validBoardPhotoBlob } from "./patientBoardPhoto";

describe("Arquivos de foto da prancha", () => {
  it("recusa um arquivo que se identifica como JPEG mas não possui assinatura de imagem", async () => {
    const disguised = new File(["texto em vez de uma imagem"], "foto.jpg", { type: "image/jpeg" });
    await expect(prepareBoardPhoto(disguised as unknown as globalThis.File, false)).rejects.toThrow(/imagem válida/);
  });

  it("recusa arquivos vazios, formatos ativos e arquivos acima do limite do proxy privado", () => {
    expect(validBoardPhotoBlob(new Blob([], { type: "image/jpeg" }))).toBe(false);
    expect(validBoardPhotoBlob(new Blob(["<svg/>"], { type: "image/svg+xml" }))).toBe(false);
    expect(validBoardPhotoBlob(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/png" }))).toBe(false);
  });
});
