import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalPhraseCache, type LocalPhraseClip } from "./localPhrasePlayer";

let decode: ReturnType<typeof vi.fn<(bytes: ArrayBuffer) => Promise<AudioBuffer>>>;
let contexts: MockContext[];
let caches: ReturnType<typeof createLocalPhraseCache>[];

class MockContext {
  close = vi.fn(async () => {});
  decodeAudioData = vi.fn((bytes: ArrayBuffer) => decode(bytes));
  constructor(_options?: AudioContextOptions) { contexts.push(this); }
}

function pcm(samples: number[] | Float32Array, sampleRate = 1000): AudioBuffer {
  const values = new Float32Array(samples);
  return {
    length: values.length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => values,
  } as unknown as AudioBuffer;
}

function clip(key: string, id = 1): LocalPhraseClip {
  return { key, blob: new Blob([new Uint8Array([id])], { type: "audio/mpeg" }) };
}

function cache() {
  const value = createLocalPhraseCache();
  caches.push(value);
  return value;
}

function read(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  contexts = [];
  caches = [];
  decode = vi.fn(async () => pcm([0, 0.4, 0.4, 0]));
  vi.stubGlobal("AudioContext", MockContext);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No HTTP is allowed"); }));
});

afterEach(() => {
  caches.forEach((value) => value.clear());
  vi.unstubAllGlobals();
});

describe("localPhraseCache", () => {
  it("assembles trimmed words in order, including repetitions, as a synchronous cached WAV", async () => {
    decode.mockImplementation(async (bytes) => {
      const value = new Uint8Array(bytes)[0] === 1 ? 0.5 : -0.25;
      return pcm([...new Array(200).fill(0), ...new Array(100).fill(value), ...new Array(200).fill(0)]);
    });
    const value = cache();
    const a = clip("Francisca:Água", 1);
    const b = clip("Francisca:Mais", 2);
    const clips = [a, b, a];
    expect(value.supported).toBe(true);
    expect(value.get(clips)).toBeUndefined();
    const result = await value.prepare(clips);
    expect(value.get(clips)).toBe(result);
    expect(result.type).toBe("audio/wav");
    expect(decode).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
    const data = new DataView(await read(result));
    expect(String.fromCharCode(...new Uint8Array(data.buffer, 0, 4))).toBe("RIFF");
    expect(data.getUint16(22, true)).toBe(1);
    expect(data.getUint32(24, true)).toBe(1000);
    // Each 500-frame input becomes 12ms lead +100ms speech +35ms tail.
    expect(result.size).toBe(44 + (147 * 3 + 25 * 2) * 2);
    const sample = (frame: number) => data.getInt16(44 + frame * 2, true);
    expect(sample(12)).toBe(16384);
    expect(sample(147)).toBe(0); // Inter-word gap.
    expect(sample(147 + 25 + 12)).toBe(-8192);
    expect(sample((147 + 25) * 2 + 12)).toBe(16384);
  });

  it("deduplicates a phrase and shares decoding across phrases", async () => {
    const held = deferred<AudioBuffer>();
    decode.mockReturnValue(held.promise);
    const value = cache();
    const a = clip("A");
    const first = value.prepare([a]);
    expect(value.prepare([a])).toBe(first);
    const repeated = value.prepare([a, a]);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    held.resolve(pcm([0.5]));
    await Promise.all([first, repeated]);
    expect(decode).toHaveBeenCalledOnce();
    expect(value.get([a, a])).toBeDefined();
  });

  it("limits simultaneous local decoders to two", async () => {
    const held = [deferred<AudioBuffer>(), deferred<AudioBuffer>(), deferred<AudioBuffer>()];
    decode.mockImplementation(() => held[decode.mock.calls.length - 1].promise);
    const value = cache();
    const result = value.prepare([clip("A"), clip("B"), clip("C")]);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    held[0].resolve(pcm([0.5]));
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(3));
    held[1].resolve(pcm([0.4]));
    held[2].resolve(pcm([0.3]));
    await expect(result).resolves.toBeInstanceOf(Blob);
  });

  it("clears queued/active work without stale writes and reuses a fresh decoder", async () => {
    const held = deferred<AudioBuffer>();
    decode.mockReturnValue(held.promise);
    const value = cache();
    const clips = [clip("A"), clip("B"), clip("C")];
    const pending = value.prepare(clips);
    const canceled = expect(pending).rejects.toThrow("local_audio_canceled");
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    value.clear();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    held.resolve(pcm([0.5]));
    await canceled;
    expect(value.get(clips)).toBeUndefined();
    decode.mockResolvedValue(pcm([0.25]));
    await value.prepare([clips[0]]);
    expect(contexts).toHaveLength(2);
    expect(value.get([clips[0]])).toBeDefined();
  });

  it("keeps failures retryable and rejects silent or invalid input", async () => {
    const value = cache();
    const a = clip("A");
    decode.mockRejectedValueOnce(new Error("decode failed"));
    await expect(value.prepare([a])).rejects.toThrow("decode failed");
    expect(value.get([a])).toBeUndefined();
    await expect(value.prepare([a])).resolves.toBeInstanceOf(Blob);
    decode.mockResolvedValue(pcm([0, 0, 0]));
    await expect(value.prepare([clip("silent")])).rejects.toThrow("silent_local_audio");
    await expect(value.prepare([])).rejects.toThrow("invalid_local_phrase");
    await expect(value.prepare(new Array(13).fill(a))).rejects.toThrow("invalid_local_phrase");
    expect(value.get([])).toBeUndefined();
  });

  it("bounds joined duration and WAV bytes before allocating the output", async () => {
    const value = cache();
    decode.mockResolvedValue(pcm(new Float32Array(4000).fill(0.2), 1000));
    await expect(value.prepare(new Array(12).fill(clip("long")))).rejects.toThrow("local_phrase_too_large");
    decode.mockResolvedValue(pcm(new Float32Array(6 * 96000).fill(0.2), 96000));
    await expect(value.prepare(new Array(4).fill(clip("large")))).rejects.toThrow("local_phrase_too_large");
  });

  it("evicts phrase WAVs by least recent use at the entry limit", async () => {
    const value = cache();
    const clips = Array.from({ length: 18 }, (_, index) => clip(`word-${index}`));
    for (const item of clips.slice(0, 17)) await value.prepare([item]);
    expect(value.get([clips[0]])).toBeUndefined();
    expect(value.get([clips[1]])).toBeDefined(); // Mark the second as recently used.
    await value.prepare([clips[17]]);
    expect(value.get([clips[2]])).toBeUndefined();
    expect(value.get([clips[1]])).toBeDefined();
  });

  it("reports unavailable local decoding without creating a context", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const value = cache();
    expect(value.supported).toBe(false);
    await expect(value.prepare([clip("A")])).rejects.toThrow("invalid_local_phrase");
    expect(contexts).toHaveLength(0);
  });
});
