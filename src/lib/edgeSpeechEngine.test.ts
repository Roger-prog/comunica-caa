import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { createEdgeSpeechEngine } from "./edgeSpeechEngine";
import type { SpeechCallbacks, SpeechEngine } from "./speechEngine";

let audios: MockAudio[];
let playBehavior: () => Promise<void>;
let fetchMock: ReturnType<typeof vi.fn>;
let createUrl: Mock<(blob: Blob | MediaSource) => string>;
let revokeUrl: Mock<(url: string) => void>;
let engines: SpeechEngine[];

class MockAudio {
  src = "";
  volume = 1;
  playbackRate = 1;
  preservesPitch = false;
  preload = "";
  readyState = 0;
  onloadeddata: (() => void) | null = null;
  oncanplaythrough: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener = vi.fn();
  play = vi.fn(() => playBehavior());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  constructor() {
    audios.push(this);
  }
}

function callbacks() {
  return {
    onEnd: vi.fn<SpeechCallbacks["onEnd"]>(),
    onError: vi.fn<SpeechCallbacks["onError"]>(),
  };
}

function phraseVocabulary(clip: Blob) {
  return (text: string) => ["Mais", "Água"].includes(text) ? clip : undefined;
}

function response(bytes = 12, overrides: Partial<Response> = {}): Response {
  return {
    ok: true,
    headers: new Headers({ "Content-Type": "audio/mpeg" }),
    body: null,
    blob: vi.fn(
      async () => new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }),
    ),
    ...overrides,
  } as Response;
}

function engine(
  endpoint?: string,
  bundledAudio: (text: string, voice: string) => Blob | undefined = () => undefined,
  localPhrases?: Parameters<typeof createEdgeSpeechEngine>[2],
) {
  const value = createEdgeSpeechEngine(endpoint, bundledAudio, localPhrases);
  engines.push(value);
  return value;
}

beforeEach(() => {
  audios = [];
  engines = [];
  playBehavior = () => Promise.resolve();
  fetchMock = vi.fn(async () => response());
  createUrl = vi.fn<(blob: Blob | MediaSource) => string>(
    () => `blob:tts-${createUrl.mock.calls.length}`,
  );
  revokeUrl = vi.fn<(url: string) => void>();
  const BaseURL = URL;
  vi.stubGlobal(
    "URL",
    class extends BaseURL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    },
  );
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  engines.forEach((value) => {
    value.cancel();
    value.clearCache?.();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("edgeSpeechEngine", () => {
  it("plays a prepared board phrase synchronously without HTTP and preserves symbol order", async () => {
    const clip = new Blob(["ID3word"], { type: "audio/mpeg" });
    const wav = new Blob(["RIFFphrase"], { type: "audio/wav" });
    const lookup = vi.fn(phraseVocabulary(clip));
    const phrases = {
      supported: true,
      get: vi.fn((_clips: readonly { key: string; blob: Blob }[]) => wav),
      prepare: vi.fn(async () => wav),
      clear: vi.fn(),
    };
    const events = callbacks();
    const voice = engine(undefined, lookup, phrases);
    const playback = voice.speak("Mais Água Mais", {
      segments: ["Mais", "Água", "Mais"],
      voiceURI: "pt-BR-AntonioNeural",
      rate: 0.8,
    }, events);
    expect(audios[0].play).toHaveBeenCalledOnce();
    expect(audios[0].playbackRate).toBe(0.8);
    expect(audios[0].preservesPitch).toBe(true);
    expect(createUrl).toHaveBeenCalledExactlyOnceWith(wav);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(phrases.prepare).not.toHaveBeenCalled();
    expect(phrases.get.mock.calls[0][0].map((item: { key: string }) => JSON.parse(item.key))).toEqual([
      ["Mais", "pt-BR-AntonioNeural"], ["Água", "pt-BR-AntonioNeural"], ["Mais", "pt-BR-AntonioNeural"],
    ]);
    await playback;
    audios[0].onended?.();
    expect(events.onEnd).toHaveBeenCalledOnce();
  });

  it("finishes a cold phrase locally and never sends it to the TTS endpoint", async () => {
    const clip = new Blob(["ID3word"], { type: "audio/mpeg" });
    const wav = new Blob(["RIFFphrase"], { type: "audio/wav" });
    let finish!: (blob: Blob) => void;
    const phrases = {
      supported: true,
      get: vi.fn(() => undefined),
      prepare: vi.fn(() => new Promise<Blob>((resolve) => { finish = resolve; })),
      clear: vi.fn(),
    };
    const voice = engine(undefined, phraseVocabulary(clip), phrases);
    const events = callbacks();
    const playback = voice.speak("Mais Água", { segments: ["Mais", "Água"] }, events);
    expect(phrases.prepare).toHaveBeenCalledOnce();
    expect(audios).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    finish(wav);
    await playback;
    expect(audios[0].play).toHaveBeenCalledOnce();
    expect(audios[0].playbackRate).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not start a locally assembled phrase after stop or a newer selection", async () => {
    const clip = new Blob(["ID3word"], { type: "audio/mpeg" });
    let finish!: (blob: Blob) => void;
    const phrases = {
      supported: true,
      get: vi.fn(() => undefined),
      prepare: vi.fn(() => new Promise<Blob>((resolve) => { finish = resolve; })),
      clear: vi.fn(),
    };
    const voice = engine(undefined, phraseVocabulary(clip), phrases);
    const events = callbacks();
    const playback = voice.speak("Mais Água", { segments: ["Mais", "Água"] }, events);
    voice.cancel();
    finish(new Blob(["RIFFphrase"], { type: "audio/wav" }));
    await playback;
    expect(audios).toHaveLength(0);
    expect(events.onEnd).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prepares phrase audio silently and cancels deferred work on edits or cleanup", async () => {
    vi.useFakeTimers();
    const clip = new Blob(["ID3word"], { type: "audio/mpeg" });
    const phrases = {
      supported: true,
      get: vi.fn(() => undefined),
      prepare: vi.fn(async () => new Blob(["WAVE"], { type: "audio/wav" })),
      clear: vi.fn(),
    };
    const voice = engine(undefined, phraseVocabulary(clip), phrases);
    const cancel = voice.prepareSentence!(["Mais", "Água"]);
    cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(phrases.prepare).not.toHaveBeenCalled();
    voice.prepareSentence!(["Água", "Mais"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(phrases.prepare).toHaveBeenCalledOnce();
    expect(audios).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    voice.prepareSentence!(["Mais", "Mais"]);
    voice.clearCache!();
    await vi.advanceTimersByTimeAsync(0);
    expect(phrases.prepare).toHaveBeenCalledOnce();
    expect(phrases.clear).toHaveBeenCalledOnce();
  });

  it("reports local phrase preparation failures without a hidden HTTP request", async () => {
    const clip = new Blob(["ID3word"], { type: "audio/mpeg" });
    const phrases = {
      supported: true,
      get: vi.fn(() => undefined),
      prepare: vi.fn(async (): Promise<Blob> => { throw new Error("private_decoder_diagnostic"); }),
      clear: vi.fn(),
    };
    const events = callbacks();
    await engine(undefined, phraseVocabulary(clip), phrases).speak("Mais Água", { segments: ["Mais", "Água"] }, events);
    expect(events.onError).toHaveBeenCalledExactlyOnceWith("failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(audios).toHaveLength(0);
  });

  it("keeps text outside the exact board segments on the existing TTS path", async () => {
    const clip = new Blob(["ID3word"], { type: "audio/mpeg" });
    const phrases = {
      supported: true,
      get: vi.fn(() => undefined),
      prepare: vi.fn(async () => clip),
      clear: vi.fn(),
    };
    await engine(undefined, phraseVocabulary(clip), phrases).speak("Outra frase", { segments: ["Mais", "Água"] }, callbacks());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(phrases.prepare).not.toHaveBeenCalled();
  });

  it("plays a bundled word on its first click synchronously without prefetch or HTTP", async () => {
    const blob = new Blob(["ID3neural"], { type: "audio/mpeg" });
    const lookup = vi.fn((text: string, voice: string) =>
      text === "Água" && voice === "pt-BR-FranciscaNeural" ? blob : undefined,
    );
    const voice = engine(undefined, lookup);
    const events = callbacks();

    const playback = voice.speak("  Água  ", {}, events);

    // This assertion runs in the same stack as the first user gesture.
    expect(audios).toHaveLength(1);
    expect(audios[0].play).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalledExactlyOnceWith(blob);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(audios[0].playbackRate).toBe(1);
    expect(audios[0].preservesPitch).toBe(true);
    await playback;
    expect(events.onError).not.toHaveBeenCalled();
  });

  it("skips bundled vocabulary during prefetch and downloads only new text", async () => {
    const blob = new Blob(["ID3neural"], { type: "audio/mpeg" });
    const voice = engine(undefined, (text) => ["Água", "Mais"].includes(text) ? blob : undefined);

    voice.prefetch?.(["Água", "Mais", "Frase nova"]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toBe("Frase nova");
    expect(audios).toHaveLength(0);
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("uses the selected neural recording and adjusts bundled speed without changing pitch", async () => {
    const first = new Blob(["ID3francisca"], { type: "audio/mpeg" });
    const second = new Blob(["ID3antonio"], { type: "audio/mpeg" });
    const lookup = vi.fn((_text: string, voice: string) =>
      voice === "pt-BR-AntonioNeural" ? second : first,
    );
    const voice = engine(undefined, lookup);
    await voice.speak("Água", { voiceURI: "pt-BR-AntonioNeural", rate: 0.8, volume: 0.4 }, callbacks());
    expect(createUrl).toHaveBeenLastCalledWith(second);
    expect(audios[0].playbackRate).toBe(0.8);
    expect(audios[0].preservesPitch).toBe(true);
    expect(audios[0].volume).toBe(0.4);
    await voice.speak("Água", { rate: 1.5 }, callbacks());
    expect(createUrl).toHaveBeenLastCalledWith(first);
    expect(audios[1].playbackRate).toBe(1.5);
    expect(fetchMock).not.toHaveBeenCalled();
    voice.clearCache?.();
    const playback = voice.speak("Água", { rate: 1 }, callbacks());
    expect(audios[2].play).toHaveBeenCalledOnce();
    await playback;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("synthesizes new phrases with speed applied only once by the API", async () => {
    const voice = engine(undefined, () => undefined);
    await voice.speak("Eu quero água, por favor.", { rate: 0.8 }, callbacks());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).rate).toBe(0.8);
    expect(audios[0].playbackRate).toBe(1);
    expect(audios[0].preservesPitch).toBe(true);
  });

  it("reuses one base recording across playback speeds and releases it with session cleanup", async () => {
    const blob = new Blob(["ID3neural"], { type: "audio/mpeg" });
    const lookup = vi.fn(() => blob);
    const voice = engine(undefined, lookup);
    voice.prefetch?.(["Água"]);
    await voice.speak("Água", { rate: 0.8 }, callbacks());
    await voice.speak("Água", { rate: 1.5 }, callbacks());
    expect(lookup).toHaveBeenCalledExactlyOnceWith("Água", "pt-BR-FranciscaNeural");
    expect(audios[0].playbackRate).toBe(0.8);
    expect(audios[1].playbackRate).toBe(1.5);
    voice.clearCache?.();
    const playback = voice.speak("Água", {}, callbacks());
    expect(audios[2].play).toHaveBeenCalledOnce();
    await playback;
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefetches silently and plays a cached word synchronously with no new HTTP", async () => {
    const voice = engine();
    voice.prefetch?.(["  Água  ", "Água", "Mais"]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(audios).toHaveLength(0);
    expect(createUrl).not.toHaveBeenCalled();
    const events = callbacks();
    const playback = voice.speak("Água", {}, events);
    // No promise has been awaited after the user's selection.
    expect(audios).toHaveLength(1);
    expect(audios[0].play).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await playback;
    expect(events.onError).not.toHaveBeenCalled();
  });

  it("shares a prefetch download with a click and preserves it when prefetch is canceled", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    const voice = engine();
    const cancelPrefetch = voice.prefetch?.(["Água", "Mais"]);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    const events = callbacks();
    const playback = voice.speak("Água", {}, events);
    expect(fetchMock).toHaveBeenCalledOnce();
    cancelPrefetch?.();
    expect(signal.aborted).toBe(false); // The foreground still owns this request.
    resolve(response());
    await playback;
    expect(audios[0].play).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(events.onError).not.toHaveBeenCalled();
  });

  it("runs one background download while an unrelated click starts immediately", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    const voice = engine();
    voice.prefetch?.(["Água", "Mais", "Olá"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    await voice.speak("Ajuda", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).text).toBe("Ajuda");
    expect(audios[0].play).toHaveBeenCalledOnce();
    resolve(response());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).text))
      .toEqual(["Água", "Ajuda", "Mais", "Olá"]);
  });

  it("merges prefetch subscribers and cancels only after their last owner leaves", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    const voice = engine();
    const first = voice.prefetch?.(["Água"]);
    const second = voice.prefetch?.(["Água"]);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    first?.();
    expect(signal.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    second?.();
    expect(signal.aborted).toBe(true);
    resolve(response());
    await Promise.resolve();
    await Promise.resolve();
    await voice.speak("Água", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(2); // Canceled bytes never enter the cache.
  });

  it("keeps prefetch failures silent, stops the batch and retries on explicit speech", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const voice = engine();
    voice.prefetch?.(["Água", "Mais", "Olá"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(audios).toHaveLength(0);
    await voice.speak("Água", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audios[0].play).toHaveBeenCalledOnce();
  });

  it("isolates cache entries by text, voice and rate while ignoring playback volume", async () => {
    const voice = engine();
    await voice.speak("Água", {}, callbacks());
    await voice.speak("  Água  ", { voiceURI: "obsolete-voice", rate: 1, volume: 0.2 }, callbacks());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(audios[1].volume).toBe(0.2);
    await voice.speak("Água", { voiceURI: "pt-BR-AntonioNeural" }, callbacks());
    await voice.speak("Água", { rate: 0.8 }, callbacks());
    await voice.speak("Mais", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("caps queued vocabulary to 64 words and evicts the least recently used blob", async () => {
    const voice = engine();
    voice.prefetch?.(Array.from({ length: 100 }, (_, index) => `Palavra ${index}`));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(64));
    await voice.speak("Palavra 63", {}, callbacks());
    await voice.speak("Palavra 0", {}, callbacks()); // Touch the first entry.
    expect(fetchMock).toHaveBeenCalledTimes(64);
    await voice.speak("Nova", {}, callbacks());
    await voice.speak("Palavra 0", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(65);
    await voice.speak("Palavra 1", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(66);
  });

  it("enforces the 8 MiB cache budget independently of entry count", async () => {
    fetchMock.mockImplementation(async () => response(2 * 1024 * 1024));
    const voice = engine();
    for (let index = 0; index < 5; index++)
      await voice.speak(`Palavra ${index}`, {}, callbacks());
    await voice.speak("Palavra 4", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await voice.speak("Palavra 0", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("expires a blob after ten minutes without extending TTL on reads", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const voice = engine();
    await voice.speak("Água", {}, callbacks());
    now = 599_999;
    await voice.speak("Água", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledOnce();
    now = 600_000;
    await voice.speak("Água", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears retained blobs and pending prefetch but remains reusable after cleanup", async () => {
    const voice = engine();
    await voice.speak("Água", {}, callbacks());
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    voice.prefetch?.(["Mais", "Olá"]);
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    voice.clearCache?.();
    expect(signal.aborted).toBe(true);
    expect(audios[0].pause).toHaveBeenCalledOnce();
    resolve(response());
    await Promise.resolve();
    await Promise.resolve();
    await voice.speak("Água", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(audios[1].play).toHaveBeenCalledOnce();
    await voice.speak("Mais", {}, callbacks());
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("offers the two Brazilian neural voices and posts a bounded payload", async () => {
    const voice = engine("https://voice.example.test/api/tts");
    expect(voice.supported).toBe(true);
    expect(voice.getVoices().map((item) => item.voiceURI)).toEqual([
      "pt-BR-FranciscaNeural",
      "pt-BR-AntonioNeural",
    ]);
    expect(voice.getVoices().every((item) => item.lang === "pt-BR")).toBe(true);
    const events = callbacks();
    await voice.speak(
      "  Quero água.  ",
      { voiceURI: "pt-BR-AntonioNeural", rate: 2, volume: 0.4 },
      events,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, options] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("https://voice.example.test/api/tts");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    expect(JSON.parse(options.body)).toEqual({
      text: "Quero água.",
      voice: "pt-BR-AntonioNeural",
      rate: 1.5,
    });
    expect(audios).toHaveLength(1);
    expect(audios[0].volume).toBe(0.4);
    expect(audios[0].src).toMatch(/^blob:tts-/);
    expect(audios[0].play).toHaveBeenCalledOnce();
    expect(events.onError).not.toHaveBeenCalled();
  });

  it("uses Francisca by default and ignores obsolete native voice identifiers", async () => {
    const voice = engine();
    await voice.speak(
      "Olá",
      { voiceURI: "old-browser-voice", rate: 0.1, volume: 3 },
      callbacks(),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      text: "Olá",
      voice: "pt-BR-FranciscaNeural",
      rate: 0.5,
    });
    expect(audios[0].volume).toBe(1);
  });

  it("plays a streamed MP3 Blob immediately without readiness events or a second request", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([73, 68]) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([51, 1]) })
      .mockResolvedValueOnce({ done: true });
    const releaseLock = vi.fn();
    const streamed = response(0, {
      body: {
        getReader: () => ({ read, releaseLock }),
      } as unknown as ReadableStream<Uint8Array<ArrayBuffer>>,
    });
    fetchMock.mockResolvedValueOnce(streamed);
    const events = callbacks();

    await engine().speak("Água", {}, events);

    // No loadeddata/canplaythrough events have been emitted and readyState is 0.
    const audio = audios[0];
    expect(audio.readyState).toBe(0);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.load).not.toHaveBeenCalled();
    expect(audio.addEventListener).not.toHaveBeenCalled();
    expect(audio.onloadeddata).toBeNull();
    expect(audio.oncanplaythrough).toBeNull();
    expect(audio.src).toBe("blob:tts-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(streamed.blob).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalledOnce();
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBe(4);
    expect(events.onError).not.toHaveBeenCalled();
  });

  it.each(["   ", "x".repeat(1001)])(
    "does not request invalid text",
    async (text) => {
      const events = callbacks();
      await engine().speak(text, {}, events);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(events.onError).toHaveBeenCalledWith("failed");
    },
  );

  it("cancels an in-flight request and ignores its late response", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const voice = engine();
    const events = callbacks();
    const request = voice.speak("Água", {}, events);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    voice.cancel();
    expect(signal.aborted).toBe(true);
    resolve(response());
    await request;
    expect(audios).toHaveLength(0);
    expect(createUrl).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
    expect(events.onEnd).not.toHaveBeenCalled();
  });

  it("lets a newer selection win over an older slow response", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const voice = engine();
    const oldEvents = callbacks();
    const oldRequest = voice.speak("Primeira", {}, oldEvents);
    await voice.speak("Segunda", {}, callbacks());
    resolve(response());
    await oldRequest;
    expect(audios).toHaveLength(1);
    expect(audios[0].play).toHaveBeenCalledOnce();
    expect(oldEvents.onEnd).not.toHaveBeenCalled();
    expect(oldEvents.onError).not.toHaveBeenCalled();
  });

  it("cleans ended playback and releases its object URL exactly once", async () => {
    const voice = engine();
    const events = callbacks();
    await voice.speak("Olá", {}, events);
    const audio = audios[0];
    const url = audio.src;
    audio.onended?.();
    expect(events.onEnd).toHaveBeenCalledOnce();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.load).toHaveBeenCalledOnce();
    expect(audio.src).toBe("");
    expect(audio.onended).toBeNull();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith(url);
    voice.cancel();
    expect(revokeUrl).toHaveBeenCalledOnce();
  });

  it("pauses and releases previous audio when another symbol is selected", async () => {
    const voice = engine();
    await voice.speak("Água", {}, callbacks());
    const first = audios[0];
    const url = first.src;
    await voice.speak("Mais", {}, callbacks());
    expect(first.pause).toHaveBeenCalledOnce();
    expect(first.onended).toBeNull();
    expect(revokeUrl).toHaveBeenCalledWith(url);
    expect(audios[1].play).toHaveBeenCalledOnce();
  });

  it.each([422, 502, 503, 504])(
    "handles HTTP %s without reading or exposing the error body",
    async (status) => {
      const failed = response(0, { ok: false, status });
      const readText = vi.fn(async () => "private_backend_diagnostic");
      failed.text = readText;
      fetchMock.mockResolvedValueOnce(failed);
      const events = callbacks();
      await engine().speak("Olá", {}, events);
      expect(events.onError).toHaveBeenCalledExactlyOnceWith("failed");
      expect(readText).not.toHaveBeenCalled();
      expect(failed.blob).not.toHaveBeenCalled();
      expect(audios).toHaveLength(0);
    },
  );

  it.each([
    response(12, {
      headers: new Headers({ "Content-Type": "application/json" }),
    }),
    response(0),
    response(2 * 1024 * 1024 + 1),
    response(12, {
      headers: new Headers({
        "Content-Type": "audio/mpeg",
        "Content-Length": String(2 * 1024 * 1024 + 1),
      }),
    }),
  ])("rejects non-MP3, empty or oversized responses", async (invalid) => {
    fetchMock.mockResolvedValueOnce(invalid);
    const events = callbacks();
    await engine().speak("Olá", {}, events);
    expect(events.onError).toHaveBeenCalledExactlyOnceWith("failed");
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("limits an actual streamed response even without Content-Length", async () => {
    const cancelReader = vi.fn(async () => {});
    const releaseLock = vi.fn();
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        done: false,
        value: new Uint8Array(2 * 1024 * 1024),
      })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(1) });
    const streamed = response(0, {
      body: {
        getReader: () => ({ read, cancel: cancelReader, releaseLock }),
      } as unknown as ReadableStream<Uint8Array<ArrayBuffer>>,
    });
    fetchMock.mockResolvedValueOnce(streamed);
    const events = callbacks();
    await engine().speak("Olá", {}, events);
    expect(cancelReader).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(events.onError).toHaveBeenCalledExactlyOnceWith("failed");
  });

  it("keeps a blocked MP3 for a direct retry without another fetch", async () => {
    playBehavior = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    const voice = engine();
    const events = callbacks();
    await voice.speak("Olá", {}, events);
    const audio = audios[0];
    const url = audio.src;
    expect(events.onError).toHaveBeenCalledExactlyOnceWith("not-allowed");
    expect(revokeUrl).not.toHaveBeenCalled();
    const replay = voice.retryPlayback?.();
    expect(audio.play).toHaveBeenCalledTimes(2); // Happens before awaiting the promise.
    await replay;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(audio.src).toBe(url);
    audio.onended?.();
    expect(events.onEnd).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith(url);
  });

  it("cleans a blocked MP3 on cancellation", async () => {
    playBehavior = () =>
      Promise.reject(new DOMException("blocked", "NotAllowedError"));
    const voice = engine();
    await voice.speak("Olá", {}, callbacks());
    const url = audios[0].src;
    voice.cancel();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith(url);
    expect(audios[0].pause).toHaveBeenCalledOnce();
    await voice.retryPlayback?.();
    expect(audios[0].play).toHaveBeenCalledOnce();
  });

  it("cleans audio decoder errors and non-permission play failures", async () => {
    const voice = engine();
    const decoderEvents = callbacks();
    await voice.speak("Olá", {}, decoderEvents);
    audios[0].onerror?.();
    expect(decoderEvents.onError).toHaveBeenCalledExactlyOnceWith("failed");
    expect(revokeUrl).toHaveBeenCalledOnce();
    playBehavior = () =>
      Promise.reject(new Error("private_playback_diagnostic"));
    const playEvents = callbacks();
    await voice.speak("Mais", {}, playEvents);
    expect(playEvents.onError).toHaveBeenCalledExactlyOnceWith("failed");
    expect(revokeUrl).toHaveBeenCalledTimes(2);
  });

  it("aborts downloads after 30 seconds without duplicated errors", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const events = callbacks();
    const request = engine().speak("Olá", {}, events);
    await vi.advanceTimersByTimeAsync(30_000);
    await request;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(events.onError).toHaveBeenCalledExactlyOnceWith("failed");
    expect(audios).toHaveLength(0);
  });

  it("does not cut long playback after the download timeout", async () => {
    vi.useFakeTimers();
    const events = callbacks();
    await engine().speak("Olá", {}, events);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(events.onError).not.toHaveBeenCalled();
    expect(audios[0].pause).not.toHaveBeenCalled();
  });
});
