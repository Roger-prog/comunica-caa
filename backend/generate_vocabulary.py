"""Build public neural vocabulary assets; never process user/history text."""

import asyncio
import hashlib
import json
import re
import subprocess
from contextlib import aclosing
from pathlib import Path

import edge_tts
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
VOICES = {"francisca": "pt-BR-FranciscaNeural", "antonio": "pt-BR-AntonioNeural"}
MAX_BYTES = 2 * 1024 * 1024


def vocabulary():
    source = (ROOT / "src" / "data" / "pictograms.ts").read_text(encoding="utf-8")
    entries = re.findall(r'id:\s*"([a-z0-9-]+)",\s*label:\s*"([^"\r\n]+)"', source)
    if not entries or len({item[0] for item in entries}) != len(entries):
        raise ValueError("Invalid built-in vocabulary")
    return entries


def trim_start(audio: bytes) -> bytes:
    # Keep 15ms before detected speech; avoid provider silence at the start.
    process = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
         "-i", "pipe:0", "-af",
         "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-55dB:start_silence=0.015",
         "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k",
         "-map_metadata", "-1", "-f", "mp3", "pipe:1"],
        input=audio, capture_output=True, check=True, timeout=20,
    )
    if not process.stdout or len(process.stdout) > MAX_BYTES:
        raise ValueError("Invalid optimized audio")
    return process.stdout


async def generate_one(folder, voice, identifier, label, slots):
    target = ROOT / "src" / "assets" / "voices" / folder / f"{identifier}.mp3"
    # Re-run to add missing vocabulary without contacting the provider again.
    if target.is_file() and 0 < target.stat().st_size <= MAX_BYTES:
        return target
    async with slots:
        audio = bytearray()
        async with aclosing(edge_tts.Communicate(label, voice, rate="+0%").stream()) as stream:
            async for chunk in stream:
                if chunk.get("type") == "audio":
                    audio.extend(chunk["data"])
                    if len(audio) > MAX_BYTES:
                        raise ValueError("Generated audio exceeds limit")
        if not audio:
            raise ValueError("No audio generated")
        optimized = await asyncio.to_thread(trim_start, bytes(audio))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(optimized)
        print(f"Generated {folder}/{identifier}.mp3", flush=True)
        return target


def write_catalog(entries):
    imports, mappings = [], []
    for folder, voice in VOICES.items():
        pairs = []
        for identifier, label in entries:
            symbol = f"{folder}_{identifier.replace('-', '_')}"
            imports.append(f'import {symbol} from "../assets/voices/{folder}/{identifier}.mp3?inline";')
            pairs.append(f"    [{json.dumps(label, ensure_ascii=False)}, {symbol}],")
        mappings.append(f'  [{json.dumps(voice)}, new Map([\n' + "\n".join(pairs) + "\n  ])],")
    body = "\n".join(imports) + "\n\n"
    body += "// Public, pre-generated vocabulary; inline imports perform no runtime download.\n"
    body += "const clips = new Map<string, Map<string, string>>([\n" + "\n".join(mappings) + "\n]);\n\n"
    body += '''/** Decode only public built-in clips; the engine owns any retained Blob. */
export function getBundledSpeechAudio(text: string, voice: string): Blob | undefined {
  const source = clips.get(voice)?.get(text.trim());
  if (!source) return;
  const match = /^data:audio\\/(?:mpeg|mp3);base64,(.+)$/.exec(source);
  if (!match) throw new Error("invalid_bundled_audio");
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "audio/mpeg" });
}
'''
    (ROOT / "src" / "data" / "bundledSpeech.ts").write_text(body, encoding="utf-8")


async def main():
    entries = vocabulary()
    slots = asyncio.Semaphore(2)
    files = await asyncio.gather(*[
        generate_one(folder, voice, identifier, label, slots)
        for folder, voice in VOICES.items() for identifier, label in entries
    ])
    write_catalog(entries)
    inventory = []
    for path in sorted(files):
        data = path.read_bytes()
        inventory.append({"file": path.relative_to(ROOT).as_posix(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    (ROOT / "src" / "assets" / "voices" / "manifest.json").write_text(
        json.dumps({"format": "audio/mpeg", "sample_rate": 24000, "voices": VOICES, "clips": inventory}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps({"clips": len(files), "bytes": sum(path.stat().st_size for path in files)}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
