import type {
  SpeechCallbacks,
  SpeechEngine,
  SpeechFailure,
  SpeechOptions,
  SpeechVoice,
} from "./speechEngine";
import { getBundledSpeechAudio } from "../data/bundledSpeech";
import { createLocalPhraseCache } from "./localPhrasePlayer";

const MAX_TEXT_LENGTH = 1_000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const CACHE_MAX_ENTRIES = 64;
const CACHE_MAX_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60_000;
const VOICES: readonly SpeechVoice[] = [
  {
    voiceURI: "pt-BR-FranciscaNeural",
    name: "Francisca · voz neural",
    lang: "pt-BR",
  },
  {
    voiceURI: "pt-BR-AntonioNeural",
    name: "Antônio · voz neural",
    lang: "pt-BR",
  },
];

interface Playback {
  generation: number;
  key: string;
  callbacks: SpeechCallbacks;
  releaseDownload?: () => void;
  audio: HTMLAudioElement | null;
  objectUrl: string | null;
  closed: boolean;
}

interface AudioRequest {
  text: string;
  voice: string;
  rate: number;
  key: string;
}

interface Download {
  controller: AbortController;
  consumers: Set<symbol>;
  promise: Promise<Blob>;
  timer?: ReturnType<typeof setTimeout>;
}

interface PrefetchJob {
  request: AudioRequest;
  owners: Set<symbol>;
  release?: () => void;
}

function bounded(value: number | undefined, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : 1;
}

async function readAudio(response: Response): Promise<Blob> {
  const mediaType = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  const declaredSize = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    mediaType !== "audio/mpeg" ||
    declaredSize > MAX_AUDIO_BYTES
  ) {
    throw new Error("invalid_audio_response");
  }
  // Bound actual bytes too: Content-Length is optional and cannot be trusted alone.
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_AUDIO_BYTES) {
          await reader.cancel();
          throw new Error("audio_too_large");
        }
        chunks.push(new Uint8Array(value).buffer);
      }
    } finally {
      reader.releaseLock();
    }
    if (!length) throw new Error("empty_audio");
    return new Blob(chunks, { type: "audio/mpeg" });
  }
  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_AUDIO_BYTES)
    throw new Error("invalid_audio_size");
  return blob;
}

type BundledAudioLookup = (text: string, voice: string) => Blob | undefined;

/** Plays bundled symbols and assembled board phrases locally; other text uses TTS. */
export function createEdgeSpeechEngine(
  endpoint = "/api/tts",
  bundledAudio: BundledAudioLookup = getBundledSpeechAudio,
  localPhrases: ReturnType<typeof createLocalPhraseCache> = createLocalPhraseCache(),
): SpeechEngine {
  const supported =
    typeof window !== "undefined" &&
    typeof Audio === "function" &&
    typeof fetch === "function" &&
    typeof AbortController === "function" &&
    typeof URL.createObjectURL === "function" &&
    typeof URL.revokeObjectURL === "function";
  let generation = 0;
  let current: Playback | null = null;
  let cacheGeneration = 0;
  let cacheBytes = 0;
  const recordings = new Map<string, Blob>();
  const cache = new Map<string, { blob: Blob; expiresAt: number }>();
  const downloads = new Map<string, Download>();
  const backgroundQueue = new Map<string, PrefetchJob>();
  let activeBackground: PrefetchJob | null = null;
  const sentencePreparations = new Set<ReturnType<typeof setTimeout>>();

  function requestFor(text: string, options: SpeechOptions): AudioRequest | null {
    const message = text.trim();
    if (!message || Array.from(message).length > MAX_TEXT_LENGTH) return null;
    const voice = VOICES.some((item) => item.voiceURI === options.voiceURI)
      ? options.voiceURI!
      : VOICES[0].voiceURI;
    const rate = bounded(options.rate, 0.5, 1.5);
    return { text: message, voice, rate, key: JSON.stringify([message, voice, rate]) };
  }

  function bundled(request: AudioRequest): Blob | undefined {
    // Built-in vocabulary is already included in the application download.
    // Its base-rate recording is independent of the user's playback speed.
    const key = JSON.stringify([request.text, request.voice]);
    const existing = recordings.get(key);
    if (existing) return existing;
    try {
      const blob = bundledAudio(request.text, request.voice);
      if (blob?.type === "audio/mpeg" && blob.size > 0 && blob.size <= MAX_AUDIO_BYTES) {
        recordings.set(key, blob);
        return blob;
      }
    } catch {
      // An unavailable asset still permits the normal online synthesis path.
    }
  }

  function phraseClips(texts: readonly string[], request: AudioRequest) {
    if (!localPhrases.supported || texts.length < 2 || texts.length > 12) return;
    const labels = texts.map((text) => text.trim());
    if (labels.some((text) => !text) || labels.join(" ") !== request.text) return;
    const clips: Array<{ key: string; blob: Blob }> = [];
    for (const label of labels) {
      const word = requestFor(label, { voiceURI: request.voice });
      const blob = word && bundled(word);
      if (!blob) return;
      clips.push({ key: JSON.stringify([label, request.voice]), blob });
    }
    return clips;
  }

  function prepareSentence(texts: readonly string[], options: SpeechOptions = {}) {
    if (!supported) return () => {};
    const request = requestFor(texts.join(" "), options);
    const clips = request && phraseClips(texts, request);
    if (!clips || localPhrases.get(clips)) return () => {};
    const timer = setTimeout(() => {
      sentencePreparations.delete(timer);
      // Decoding and assembly never play audio or change the visible speech state.
      void localPhrases.prepare(clips).catch(() => {});
    }, 0);
    sentencePreparations.add(timer);
    return () => {
      clearTimeout(timer);
      sentencePreparations.delete(timer);
    };
  }

  function discard(key: string) {
    const previous = cache.get(key);
    if (previous) cacheBytes -= previous.blob.size;
    cache.delete(key);
  }

  function prune() {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) discard(key);
    }
  }

  function cached(key: string): Blob | undefined {
    prune();
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    cache.set(key, entry);
    return entry.blob;
  }

  function remember(key: string, blob: Blob) {
    prune();
    discard(key);
    cache.set(key, { blob, expiresAt: Date.now() + CACHE_TTL_MS });
    cacheBytes += blob.size;
    while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
      discard(cache.keys().next().value!);
    }
  }

  function acquireDownload(request: AudioRequest) {
    let download = downloads.get(request.key);
    if (!download) {
      const epoch = cacheGeneration;
      const created: Download = {
        controller: new AbortController(),
        consumers: new Set(),
        promise: undefined as unknown as Promise<Blob>,
      };
      downloads.set(request.key, created);
      created.timer = setTimeout(() => created.controller.abort(), REQUEST_TIMEOUT_MS);
      created.promise = (async () => {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
            body: JSON.stringify({ text: request.text, voice: request.voice, rate: request.rate }),
            signal: created.controller.signal,
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
          });
          if (created.controller.signal.aborted) throw new Error("aborted_audio");
          const blob = await readAudio(response);
          if (created.controller.signal.aborted || epoch !== cacheGeneration)
            throw new Error("aborted_audio");
          remember(request.key, blob);
          return blob;
        } finally {
          clearTimeout(created.timer);
          if (downloads.get(request.key) === created) downloads.delete(request.key);
        }
      })();
      download = created;
    }
    const shared = download;
    const consumer = Symbol();
    shared.consumers.add(consumer);
    let released = false;
    return {
      promise: shared.promise,
      release() {
        if (released) return;
        released = true;
        shared.consumers.delete(consumer);
        if (!shared.consumers.size) {
          clearTimeout(shared.timer);
          shared.controller.abort();
          if (downloads.get(request.key) === shared) downloads.delete(request.key);
        }
      },
    };
  }

  function pumpBackground() {
    if (activeBackground) return;
    for (const [key, job] of backgroundQueue) {
      backgroundQueue.delete(key);
      if (!job.owners.size || cached(key)) continue;
      activeBackground = job;
      const download = acquireDownload(job.request);
      job.release = download.release;
      void download.promise.then(
        () => finishBackground(job, false),
        () => finishBackground(job, true),
      );
      return;
    }
  }

  function finishBackground(job: PrefetchJob, failed: boolean) {
    job.release?.();
    if (activeBackground !== job) return;
    activeBackground = null;
    // An unavailable service must not receive the entire vocabulary in a burst.
    if (failed) backgroundQueue.clear();
    else pumpBackground();
  }

  function prefetch(texts: readonly string[], options: SpeechOptions = {}) {
    if (!supported) return () => {};
    const owner = Symbol();
    for (const text of texts.slice(0, CACHE_MAX_ENTRIES)) {
      const request = requestFor(text, options);
      if (!request || bundled(request) || cached(request.key)) continue;
      if (activeBackground?.request.key === request.key) {
        activeBackground.owners.add(owner);
        continue;
      }
      const queued = backgroundQueue.get(request.key);
      if (queued) queued.owners.add(owner);
      else if (backgroundQueue.size < CACHE_MAX_ENTRIES)
        backgroundQueue.set(request.key, { request, owners: new Set([owner]) });
    }
    pumpBackground();
    return () => {
      for (const [key, job] of backgroundQueue) {
        job.owners.delete(owner);
        if (!job.owners.size) backgroundQueue.delete(key);
      }
      if (activeBackground) {
        activeBackground.owners.delete(owner);
        if (!activeBackground.owners.size) {
          const abandoned = activeBackground;
          activeBackground = null;
          abandoned.release?.();
          pumpBackground();
        }
      }
    };
  }

  const isCurrent = (playback: Playback) =>
    current === playback &&
    !playback.closed &&
    playback.generation === generation;

  function dispose(playback: Playback) {
    if (playback.closed) return;
    playback.closed = true;
    if (current === playback) current = null;
    playback.releaseDownload?.();
    playback.releaseDownload = undefined;
    if (playback.audio) {
      playback.audio.onended = null;
      playback.audio.onerror = null;
      try {
        playback.audio.pause();
        playback.audio.removeAttribute("src");
        playback.audio.load();
      } catch {
        /* Resource release must not interrupt the next selection. */
      }
    }
    if (playback.objectUrl) URL.revokeObjectURL(playback.objectUrl);
    playback.audio = null;
    playback.objectUrl = null;
  }

  function cancel() {
    generation++;
    if (current) dispose(current);
  }

  function fail(playback: Playback, reason: SpeechFailure) {
    if (!isCurrent(playback)) return;
    if (reason !== "not-allowed") discard(playback.key);
    if (reason !== "not-allowed") dispose(playback);
    // A blocked play keeps the bounded blob for a direct, user-initiated retry.
    playback.callbacks.onError(reason);
  }

  function play(playback: Playback): void | Promise<void> {
    if (!isCurrent(playback) || !playback.audio) return;
    try {
      // Keep play() synchronous with retryPlayback's user gesture on mobile Safari.
      const result = playback.audio.play();
      return Promise.resolve(result).catch((cause: unknown) => {
        const name =
          cause && typeof cause === "object" && "name" in cause
            ? cause.name
            : null;
        fail(playback, name === "NotAllowedError" ? "not-allowed" : "failed");
      });
    } catch (cause) {
      const name =
        cause && typeof cause === "object" && "name" in cause
          ? cause.name
          : null;
      fail(playback, name === "NotAllowedError" ? "not-allowed" : "failed");
    }
  }

  function playBlob(playback: Playback, blob: Blob, volume: number, playbackRate = 1) {
    if (!isCurrent(playback)) return;
    playback.releaseDownload?.();
    playback.releaseDownload = undefined;
    const audio = new Audio();
    playback.audio = audio;
    playback.objectUrl = URL.createObjectURL(blob);
    audio.preload = "auto";
    audio.volume = volume;
    audio.playbackRate = playbackRate;
    audio.preservesPitch = true;
    audio.src = playback.objectUrl;
    audio.onended = () => {
      if (!isCurrent(playback)) return;
      dispose(playback);
      playback.callbacks.onEnd();
    };
    audio.onerror = () => fail(playback, "failed");
    // Cache hits execute play() in the original click, before any await.
    return play(playback);
  }

  return {
    supported,
    getVoices: () => VOICES.map((voice) => ({ ...voice })),
    subscribeVoices: () => () => {},
    cancel,
    prefetch,
    prepareSentence,
    clearCache() {
      cancel();
      cacheGeneration++;
      backgroundQueue.clear();
      activeBackground?.release?.();
      activeBackground = null;
      for (const download of downloads.values()) {
        clearTimeout(download.timer);
        download.controller.abort();
      }
      downloads.clear();
      recordings.clear();
      for (const timer of sentencePreparations) clearTimeout(timer);
      sentencePreparations.clear();
      localPhrases.clear();
      cache.clear();
      cacheBytes = 0;
    },
    retryPlayback() {
      if (current) return play(current);
    },
    speak(
      text: string,
      options: SpeechOptions,
      callbacks: SpeechCallbacks,
    ) {
      cancel();
      const request = requestFor(text, options);
      if (!supported || !request) {
        callbacks.onError("failed");
        return;
      }
      const playback: Playback = {
        generation: ++generation,
        key: request.key,
        callbacks,
        audio: null,
        objectUrl: null,
        closed: false,
      };
      current = playback;
      try {
        const volume = bounded(options.volume, 0, 1);
        const recording = bundled(request);
        if (recording) {
          // Selecting a symbol also prepares its PCM for the phrase being built.
          // Playback starts immediately and never awaits this background work.
          if (localPhrases.supported) {
            void localPhrases.prepare([
              { key: JSON.stringify([request.text, request.voice]), blob: recording },
            ]).catch(() => {});
          }
          return playBlob(playback, recording, volume, request.rate);
        }
        const clips = options.segments && phraseClips(options.segments, request);
        if (clips) {
          const phrase = localPhrases.get(clips);
          if (phrase) return playBlob(playback, phrase, volume, request.rate);
          // A very fast tap may precede the composition effect: finish locally,
          // with no HTTP request, and ignore completion after stop/new speech.
          return localPhrases.prepare(clips).then(
            (ready) => {
              if (!isCurrent(playback)) return;
              try { return playBlob(playback, ready, volume, request.rate); }
              catch { fail(playback, "failed"); }
            },
            () => fail(playback, "failed"),
          );
        }
        const blob = cached(request.key);
        if (blob) return playBlob(playback, blob, volume);
        const download = acquireDownload(request);
        playback.releaseDownload = download.release;
        return download.promise.then(
          (received) => {
            if (!isCurrent(playback)) return;
            try { return playBlob(playback, received, volume); }
            catch { fail(playback, "failed"); }
          },
          () => fail(playback, "failed"),
        );
      } catch {
        // Includes HTTP failures, aborted downloads and malformed audio; no body is echoed.
        fail(playback, "failed");
      }
    },
  };
}
