import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeech } from "./useSpeech";

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
  let synthesis: EventTarget & {
    getVoices: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    speak: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
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
    vi.restoreAllMocks();
  });

  it("cancels prior speech and speaks Portuguese synchronously", () => {
    const { result } = renderHook(() => useSpeech());
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
    const { result } = renderHook(() => useSpeech());
    expect(result.current.voices).toHaveLength(0);
    synthesis.getVoices.mockReturnValue([brazilianVoice]);
    act(() => synthesis.dispatchEvent(new Event("voiceschanged")));
    expect(result.current.voices).toEqual([brazilianVoice]);
  });

  it("uses a Portuguese language hint when no voices have loaded", () => {
    synthesis.getVoices.mockReturnValue([]);
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.speak("Olá"));
    expect(synthesis.speak.mock.calls[0][0].lang).toBe("pt-BR");
  });

  it("ignores an interrupted previous utterance and releases native speech on cleanup", () => {
    const { result, unmount } = renderHook(() => useSpeech());
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
    const { result } = renderHook(() => useSpeech());
    expect(result.current.supported).toBe(false);
    act(() => result.current.speak("Ajuda"));
    expect(result.current.error).toContain("texto continua visível");
    expect(synthesis.speak).not.toHaveBeenCalled();
  });
});
