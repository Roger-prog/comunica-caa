import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeech } from "./useSpeech";
import {
  createWebSpeechEngine,
  type SpeechCallbacks,
  type SpeechEngine,
} from "../lib/speechEngine";

const { createEdgeSpeechEngineMock } = vi.hoisted(() => ({
  createEdgeSpeechEngineMock: vi.fn(),
}));

vi.mock("../lib/edgeSpeechEngine", () => ({
  createEdgeSpeechEngine: createEdgeSpeechEngineMock,
}));

const neuralVoices = [
  { voiceURI: "pt-BR-FranciscaNeural", name: "Francisca", lang: "pt-BR" },
  { voiceURI: "pt-BR-AntonioNeural", name: "Antônio", lang: "pt-BR" },
];

function renderNativeSpeech() {
  const engine = createWebSpeechEngine();
  return renderHook(() => useSpeech(engine));
}

class MockUtterance {
  text: string;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const brazilianVoice = {
  voiceURI: "br-local",
  lang: "pt-BR",
  name: "Português",
  localService: true,
  default: true,
} as SpeechSynthesisVoice;
const englishVoice = {
  voiceURI: "en-local",
  lang: "en-US",
  name: "English",
  localService: true,
  default: false,
} as SpeechSynthesisVoice;

describe("useSpeech", () => {
  let neuralEngine: SpeechEngine;
  let synthesis: EventTarget & {
    getVoices: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    speak: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.stubEnv("VITE_TTS_API_URL", "");
    neuralEngine = {
      supported: true,
      getVoices: () => [...neuralVoices],
      subscribeVoices: () => () => {},
      cancel: vi.fn(),
      speak: vi.fn(),
    };
    createEdgeSpeechEngineMock.mockReset();
    createEdgeSpeechEngineMock.mockReturnValue(neuralEngine);
    synthesis = Object.assign(new EventTarget(), {
      getVoices: vi.fn(() => [englishVoice, brazilianVoice]),
      cancel: vi.fn(),
      speak: vi.fn(),
    });
    vi.stubGlobal("speechSynthesis", synthesis);
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("cancels prior speech and speaks Portuguese synchronously", () => {
    const { result } = renderNativeSpeech();
    act(() => result.current.speak("Água", { rate: 0.8 }));
    const utterance = synthesis.speak.mock.calls[0][0] as MockUtterance;
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    expect(synthesis.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      synthesis.speak.mock.invocationCallOrder[0],
    );
    expect(utterance.text).toBe("Água");
    expect(utterance.lang).toBe("pt-BR");
    expect(utterance.voice).toBe(brazilianVoice);
    expect(utterance.rate).toBe(0.8);
    expect(result.current.speaking).toBe(true);
    act(() => utterance.onend?.());
    expect(result.current.speaking).toBe(false);
  });

  it("updates voices when they become available asynchronously", () => {
    synthesis.getVoices.mockReturnValue([]);
    const { result } = renderNativeSpeech();
    expect(result.current.voices).toHaveLength(0);
    synthesis.getVoices.mockReturnValue([brazilianVoice]);
    act(() => synthesis.dispatchEvent(new Event("voiceschanged")));
    expect(result.current.voices).toEqual([brazilianVoice]);
  });

  it("uses a Portuguese language hint when no voices have loaded", () => {
    synthesis.getVoices.mockReturnValue([]);
    const { result } = renderNativeSpeech();
    act(() => result.current.speak("Olá"));
    expect(synthesis.speak.mock.calls[0][0].lang).toBe("pt-BR");
  });

  it("ignores an interrupted previous utterance and releases native speech on cleanup", () => {
    const { result, unmount } = renderNativeSpeech();
    act(() => result.current.speak("Água"));
    const previous = synthesis.speak.mock.calls[0][0] as MockUtterance;
    act(() => result.current.speak("Mais"));
    act(() => previous.onerror?.({ error: "interrupted" }));
    expect(result.current.speaking).toBe(true);
    expect(result.current.error).toBeNull();
    unmount();
    expect(synthesis.cancel).toHaveBeenCalledTimes(3);
  });

  it("provides a readable fallback when speech is unsupported", () => {
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    const { result } = renderNativeSpeech();
    expect(result.current.supported).toBe(false);
    act(() => result.current.speak("Ajuda"));
    expect(result.current.error).toContain("texto continua visível");
    expect(synthesis.speak).not.toHaveBeenCalled();
  });

  it("accepts a replacement engine without requiring browser speech APIs", () => {
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    let callbacks: SpeechCallbacks | undefined;
    const engine: SpeechEngine = {
      supported: true,
      getVoices: vi.fn(() => []),
      subscribeVoices: vi.fn(() => vi.fn()),
      cancel: vi.fn(),
      speak: vi.fn((_text, _options, events) => {
        callbacks = events;
      }),
    };
    const { result } = renderHook(() => useSpeech(engine));
    act(() => result.current.speak("Água", { rate: 0.9 }));
    expect(result.current.supported).toBe(true);
    expect(engine.speak).toHaveBeenCalledWith(
      "Água",
      { rate: 0.9 },
      expect.any(Object),
    );
    expect(result.current.speaking).toBe(true);
    expect(synthesis.speak).not.toHaveBeenCalled();
    act(() => callbacks?.onEnd());
    expect(result.current.speaking).toBe(false);
  });

  it("handles asynchronous engine failures without exposing backend diagnostics", async () => {
    const engine: SpeechEngine = {
      supported: true,
      getVoices: () => [],
      subscribeVoices: () => () => {},
      cancel: vi.fn(),
      speak: vi.fn(async () => {
        throw new Error("private_backend_diagnostic");
      }),
    };
    const { result } = renderHook(() => useSpeech(engine));
    await act(async () => result.current.speak("Olá"));
    expect(result.current.speaking).toBe(false);
    expect(result.current.error).toContain(
      "Não foi possível iniciar a leitura",
    );
    expect(result.current.error).not.toContain("private_backend_diagnostic");
  });

  it("cancels and detaches the previous engine when the implementation changes", () => {
    const unsubscribe = vi.fn();
    let staleCallbacks: SpeechCallbacks | undefined;
    const previous: SpeechEngine = {
      supported: true,
      getVoices: () => [],
      subscribeVoices: () => unsubscribe,
      cancel: vi.fn(),
      speak: (_text, _options, callbacks) => {
        staleCallbacks = callbacks;
      },
    };
    const next: SpeechEngine = { ...previous, cancel: vi.fn(), speak: vi.fn() };
    const { result, rerender } = renderHook(({ engine }) => useSpeech(engine), {
      initialProps: { engine: previous },
    });
    act(() => result.current.speak("Água"));
    expect(result.current.speaking).toBe(true);
    rerender({ engine: next });
    expect(previous.cancel).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(result.current.speaking).toBe(false);
    act(() => staleCallbacks?.onError("failed"));
    expect(result.current.error).toBeNull();
  });

  it("uses the neural API engine by default without browser speech APIs", () => {
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    const { result } = renderHook(() => useSpeech());

    expect(createEdgeSpeechEngineMock).toHaveBeenCalledExactlyOnceWith(
      "/api/tts",
    );
    expect(result.current.supported).toBe(true);
    expect(result.current.voices).toEqual(neuralVoices);
    expect(result.current.voices.every((voice) => voice.lang === "pt-BR")).toBe(
      true,
    );
    act(() => result.current.speak("Água"));
    expect(neuralEngine.speak).toHaveBeenCalledWith(
      "Água",
      {},
      expect.any(Object),
    );
    expect(synthesis.speak).not.toHaveBeenCalled();
  });

  it("uses the configured neural endpoint when provided", () => {
    vi.stubEnv("VITE_TTS_API_URL", "/api/neural-voice");
    renderHook(() => useSpeech());
    expect(createEdgeSpeechEngineMock).toHaveBeenCalledExactlyOnceWith(
      "/api/neural-voice",
    );
  });

  it("retries prepared audio synchronously during a new gesture without synthesizing again", async () => {
    let callbacks: SpeechCallbacks | undefined;
    let inUserGesture = false;
    const retryPlayback = vi.fn(() => {
      expect(inUserGesture).toBe(true);
      return Promise.resolve();
    });
    const engine: SpeechEngine = {
      ...neuralEngine,
      retryPlayback,
      speak: vi.fn((_text, _options, events) => {
        callbacks = events;
      }),
    };
    const { result } = renderHook(() => useSpeech(engine));
    act(() => result.current.speak("Água"));
    act(() => callbacks?.onError("not-allowed"));
    expect(result.current.speaking).toBe(false);
    expect(result.current.needsPlaybackGesture).toBe(true);
    expect(result.current.error).toContain("Ouvir áudio pronto");

    await act(async () => {
      inUserGesture = true;
      result.current.retryPlayback();
      inUserGesture = false;
    });
    expect(retryPlayback).toHaveBeenCalledOnce();
    expect(engine.speak).toHaveBeenCalledOnce();
    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(result.current.speaking).toBe(true);
    expect(result.current.needsPlaybackGesture).toBe(false);
    expect(result.current.error).toBeNull();

    act(() => callbacks?.onEnd());
    expect(result.current.speaking).toBe(false);
    expect(result.current.needsPlaybackGesture).toBe(false);
  });

  it("clears blocked playback on stop or a new phrase and ignores old callbacks", () => {
    const callbacks: SpeechCallbacks[] = [];
    const retryPlayback = vi.fn();
    const engine: SpeechEngine = {
      ...neuralEngine,
      retryPlayback,
      speak: vi.fn((_text, _options, events) => {
        callbacks.push(events);
      }),
    };
    const { result } = renderHook(() => useSpeech(engine));
    act(() => result.current.speak("Água"));
    act(() => callbacks[0].onError("not-allowed"));
    expect(result.current.needsPlaybackGesture).toBe(true);
    act(() => result.current.stop());
    expect(result.current.needsPlaybackGesture).toBe(false);
    expect(result.current.speaking).toBe(false);
    act(() => result.current.retryPlayback());
    expect(retryPlayback).not.toHaveBeenCalled();

    act(() => result.current.speak("Mais"));
    act(() => callbacks[0].onError("not-allowed"));
    expect(result.current.needsPlaybackGesture).toBe(false);
    expect(result.current.speaking).toBe(true);
    act(() => callbacks[1].onError("not-allowed"));
    expect(result.current.needsPlaybackGesture).toBe(true);
    act(() => result.current.speak("Comer"));
    expect(result.current.needsPlaybackGesture).toBe(false);
    expect(result.current.error).toBeNull();
    expect(engine.speak).toHaveBeenCalledTimes(3);
  });

  it("sanitizes a rejected retry and leaves no playback spinner", async () => {
    let callbacks: SpeechCallbacks | undefined;
    const engine: SpeechEngine = {
      ...neuralEngine,
      retryPlayback: vi.fn(async () => {
        throw new Error("private_playback_diagnostic");
      }),
      speak: vi.fn((_text, _options, events) => {
        callbacks = events;
      }),
    };
    const { result } = renderHook(() => useSpeech(engine));
    act(() => result.current.speak("Água"));
    act(() => callbacks?.onError("not-allowed"));
    await act(async () => result.current.retryPlayback());
    expect(result.current.speaking).toBe(false);
    expect(result.current.needsPlaybackGesture).toBe(false);
    expect(result.current.error).toContain(
      "Não foi possível reproduzir o áudio",
    );
    expect(result.current.error).not.toContain("private_playback_diagnostic");
  });

  it("prefetches through a stable callback without playing audio or changing UI state", () => {
    const release = vi.fn();
    const engine: SpeechEngine = {
      ...neuralEngine,
      prefetch: vi.fn(() => release),
      clearCache: vi.fn(),
    };
    const { result, unmount } = renderHook(() => useSpeech(engine));
    const prefetch = result.current.prefetch;
    let cancel: () => void = () => {};
    act(() => {
      cancel = prefetch(["Água", "Mais"], {
        voiceURI: "pt-BR-AntonioNeural",
        rate: 0.8,
      });
    });
    expect(engine.prefetch).toHaveBeenCalledWith(["Água", "Mais"], {
      voiceURI: "pt-BR-AntonioNeural",
      rate: 0.8,
    });
    expect(engine.speak).not.toHaveBeenCalled();
    expect(result.current.speaking).toBe(false);
    expect(result.current.error).toBeNull();
    act(() => result.current.speak("Mais"));
    expect(result.current.prefetch).toBe(prefetch);
    cancel();
    cancel();
    expect(release).toHaveBeenCalledOnce();
    unmount();
    expect(release).toHaveBeenCalledOnce();
    expect(engine.clearCache).toHaveBeenCalledOnce();
  });

  it("releases all outstanding prefetches and cached session audio on unmount", () => {
    const releaseFirst = vi.fn();
    const releaseSecond = vi.fn();
    const engine: SpeechEngine = {
      ...neuralEngine,
      prefetch: vi.fn().mockReturnValueOnce(releaseFirst).mockReturnValueOnce(releaseSecond),
      clearCache: vi.fn(),
    };
    const { result, unmount } = renderHook(() => useSpeech(engine));
    act(() => {
      result.current.prefetch(["Água"]);
      result.current.prefetch(["Mais"]);
    });
    unmount();
    expect(releaseFirst).toHaveBeenCalledOnce();
    expect(releaseSecond).toHaveBeenCalledOnce();
    expect(engine.clearCache).toHaveBeenCalledOnce();
    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it("cancels old prefetches and clears blobs when switching engines", () => {
    const release = vi.fn();
    const previous: SpeechEngine = {
      ...neuralEngine,
      prefetch: vi.fn(() => release),
      clearCache: vi.fn(),
    };
    const next: SpeechEngine = {
      ...neuralEngine,
      prefetch: vi.fn(() => () => {}),
      clearCache: vi.fn(),
    };
    const { result, rerender } = renderHook(({ engine }) => useSpeech(engine), {
      initialProps: { engine: previous },
    });
    const oldPrefetch = result.current.prefetch;
    act(() => { result.current.prefetch(["Água"]); });
    rerender({ engine: next });
    expect(release).toHaveBeenCalledOnce();
    expect(previous.clearCache).toHaveBeenCalledOnce();
    expect(result.current.prefetch).not.toBe(oldPrefetch);
    act(() => { result.current.prefetch(["Mais"]); });
    expect(next.prefetch).toHaveBeenCalledWith(["Mais"], {});
  });

  it("keeps background failures silent and supports engines without prefetch", () => {
    const engine: SpeechEngine = {
      ...neuralEngine,
      prefetch: vi.fn(() => { throw new Error("private_prefetch_diagnostic"); }),
    };
    const { result } = renderHook(() => useSpeech(engine));
    act(() => { result.current.prefetch(["Água"])(); });
    expect(result.current.error).toBeNull();
    expect(result.current.speaking).toBe(false);
    act(() => result.current.speak("Água"));
    expect(engine.speak).toHaveBeenCalledOnce();
    const native = renderNativeSpeech();
    act(() => { native.result.current.prefetch(["Água"])(); });
    expect(native.result.current.error).toBeNull();
    expect(synthesis.speak).not.toHaveBeenCalled();
  });

  it("prepares a sentence through a stable callback and forwards its exact segments when speaking", () => {
    const release = vi.fn();
    const engine: SpeechEngine = {
      ...neuralEngine,
      prepareSentence: vi.fn(() => release),
      clearCache: vi.fn(),
    };
    const { result, unmount } = renderHook(() => useSpeech(engine));
    const prepare = result.current.prepareSentence;
    let cancel: () => void = () => {};
    act(() => {
      cancel = prepare(["Água", "Mais", "Água"], {
        voiceURI: "pt-BR-AntonioNeural", rate: 0.8,
      });
    });
    expect(engine.prepareSentence).toHaveBeenCalledExactlyOnceWith(
      ["Água", "Mais", "Água"],
      { voiceURI: "pt-BR-AntonioNeural", rate: 0.8 },
    );
    expect(result.current.speaking).toBe(false);
    expect(result.current.error).toBeNull();
    expect(engine.speak).not.toHaveBeenCalled();

    const options = { segments: ["Água", "Mais", "Água"], rate: 0.8 };
    act(() => result.current.speak("Água Mais Água", options));
    expect(engine.speak).toHaveBeenCalledWith("Água Mais Água", options, expect.any(Object));
    expect(result.current.prepareSentence).toBe(prepare);
    cancel();
    cancel();
    unmount();
    expect(release).toHaveBeenCalledOnce();
    expect(engine.clearCache).toHaveBeenCalledOnce();
  });

  it("releases pending sentence preparation on engine replacement and unmount", () => {
    const previousRelease = vi.fn();
    const nextRelease = vi.fn();
    const previous: SpeechEngine = {
      ...neuralEngine,
      prepareSentence: vi.fn(() => previousRelease),
      clearCache: vi.fn(),
    };
    const next: SpeechEngine = {
      ...neuralEngine,
      prepareSentence: vi.fn(() => nextRelease),
      clearCache: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(({ engine }) => useSpeech(engine), {
      initialProps: { engine: previous },
    });
    act(() => { result.current.prepareSentence(["Água", "Mais"]); });
    rerender({ engine: next });
    expect(previousRelease).toHaveBeenCalledOnce();
    expect(previous.clearCache).toHaveBeenCalledOnce();
    act(() => { result.current.prepareSentence(["Olá", "Mais"]); });
    unmount();
    expect(nextRelease).toHaveBeenCalledOnce();
    expect(next.clearCache).toHaveBeenCalledOnce();
  });

  it("keeps empty, unsupported and failed sentence preparation silent", () => {
    const engine: SpeechEngine = {
      ...neuralEngine,
      prepareSentence: vi.fn(() => { throw new Error("private_sentence_diagnostic"); }),
    };
    const { result } = renderHook(() => useSpeech(engine));
    act(() => { result.current.prepareSentence([])(); });
    expect(engine.prepareSentence).not.toHaveBeenCalled();
    act(() => { result.current.prepareSentence(["Água", "Mais"])(); });
    expect(result.current.error).toBeNull();
    expect(result.current.speaking).toBe(false);
    const native = renderNativeSpeech();
    act(() => { native.result.current.prepareSentence(["Água", "Mais"])(); });
    expect(native.result.current.error).toBeNull();
    expect(synthesis.speak).not.toHaveBeenCalled();
  });
});
