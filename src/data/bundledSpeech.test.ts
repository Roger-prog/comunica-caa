import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getBundledSpeechAudio } from "./bundledSpeech";
import { PICTOGRAMS } from "./pictograms";

const assetsRoot = resolve(process.cwd(), "src/assets/voices");
const voices = [
  ["francisca", "pt-BR-FranciscaNeural"],
  ["antonio", "pt-BR-AntonioNeural"],
] as const;

describe("bundledSpeech: public neural vocabulary", () => {
  it.each(voices)("provides every symbol synchronously in %s without a request", (folder, voice) => {
    for (const symbol of PICTOGRAMS) {
      const blob = getBundledSpeechAudio(symbol.label, voice);
      expect(blob, symbol.label).toBeInstanceOf(Blob);
      expect(blob?.type).toBe("audio/mpeg");
      expect(blob?.size).toBeGreaterThan(0);
      expect(blob?.size).toBe(readFileSync(resolve(assetsRoot, folder, `${symbol.id}.mp3`)).length);
      // A synchronous Blob is available before any API or preload promise.
      expect(blob).not.toBeInstanceOf(Promise);
    }
  });

  it("only resolves known labels and supported voices", () => {
    expect(getBundledSpeechAudio("  Água  ", voices[0][1])?.size).toBeGreaterThan(0);
    expect(getBundledSpeechAudio("Uma frase nova", voices[0][1])).toBeUndefined();
    expect(getBundledSpeechAudio("Água", "unsupported-voice")).toBeUndefined();
    expect(getBundledSpeechAudio("", voices[0][1])).toBeUndefined();
  });

  it("ships a complete, small MP3 inventory matching its recorded checksums", () => {
    const manifest = JSON.parse(readFileSync(resolve(assetsRoot, "manifest.json"), "utf8")) as {
      clips: { file: string; bytes: number; sha256: string }[];
    };
    const expectedFiles = voices.flatMap(([folder]) =>
      PICTOGRAMS.map((symbol) => `src/assets/voices/${folder}/${symbol.id}.mp3`),
    );
    expect(manifest.clips.map((clip) => clip.file).sort()).toEqual(expectedFiles.sort());

    let totalBytes = 0;
    for (const [folder] of voices) {
      expect(readdirSync(resolve(assetsRoot, folder)).sort()).toEqual(
        PICTOGRAMS.map((symbol) => `${symbol.id}.mp3`).sort(),
      );
      for (const symbol of PICTOGRAMS) {
        const data = readFileSync(resolve(assetsRoot, folder, `${symbol.id}.mp3`));
        const recorded = manifest.clips.find((clip) => clip.file === `src/assets/voices/${folder}/${symbol.id}.mp3`);
        expect(recorded?.bytes).toBe(data.length);
        expect(recorded?.sha256).toBe(createHash("sha256").update(data).digest("hex"));
        expect(data.subarray(0, 3).toString() === "ID3" || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)).toBe(true);
        totalBytes += data.length;
      }
    }
    expect(totalBytes).toBeLessThanOrEqual(1024 * 1024);
  });
});
