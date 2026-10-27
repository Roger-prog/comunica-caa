export interface SpeechOptions {
  voiceURI?: string;
  rate?: number;
  volume?: number;
  segments?: readonly string[];
}

export interface SpeechVoice {
  voiceURI: string;
  name: string;
  lang: string;
}

export type SpeechFailure =
  "canceled" | "interrupted" | "not-allowed" | "failed";

export interface SpeechCallbacks {
  onEnd: () => void;
  onError: (reason: SpeechFailure) => void;
}

/** Voice providers implement this contract without changing the board. */
export interface SpeechEngine {
  readonly supported: boolean;
  getVoices: () => SpeechVoice[];
  subscribeVoices: (listener: () => void) => () => void;
  speak: (
    text: string,
    options: SpeechOptions,
    callbacks: SpeechCallbacks,
  ) => void | Promise<void>;
  cancel: () => void;
  retryPlayback?: () => void | Promise<void>;
  prefetch?: (texts: readonly string[], options?: SpeechOptions) => () => void;
  prepareSentence?: (texts: readonly string[], options?: SpeechOptions) => () => void;
  clearCache?: () => void;
}

function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** No browser globals are read at module import time. */
export function createWebSpeechEngine(): SpeechEngine {
  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function";
  const synthesis = supported ? window.speechSynthesis : undefined;
  let currentUtterance: SpeechSynthesisUtterance | null = null;

  return {
    supported,
    getVoices: () => synthesis?.getVoices() ?? [],
    subscribeVoices(listener) {
      synthesis?.addEventListener("voiceschanged", listener);
      return () => synthesis?.removeEventListener("voiceschanged", listener);
    },
    speak(text, options, callbacks) {
      if (!synthesis) throw new Error("speech_unavailable");
      const utterance = new window.SpeechSynthesisUtterance(text);
      const voices = synthesis.getVoices();
      const voice =
        voices.find((item) => item.voiceURI === options.voiceURI) ??
        voices.find((item) => /^pt[-_]BR$/i.test(item.lang)) ??
        voices.find((item) => /^pt(?:[-_]|$)/i.test(item.lang));
      utterance.lang = voice?.lang ?? "pt-BR";
      if (voice) utterance.voice = voice;
      utterance.rate = bounded(options.rate, 1, 0.5, 1.5);
      utterance.volume = bounded(options.volume, 1, 0, 1);
      utterance.onend = () => {
        if (currentUtterance === utterance) currentUtterance = null;
        callbacks.onEnd();
      };
      utterance.onerror = (event) => {
        if (currentUtterance === utterance) currentUtterance = null;
        const reason = event.error;
        callbacks.onError(
          reason === "not-allowed" ||
            reason === "canceled" ||
            reason === "interrupted"
            ? reason
            : "failed",
        );
      };
      // Retain native utterances and speak during the same user gesture on Safari.
      currentUtterance = utterance;
      synthesis.speak(utterance);
    },
    cancel() {
      if (currentUtterance) {
        currentUtterance.onend = null;
        currentUtterance.onerror = null;
        currentUtterance = null;
      }
      synthesis?.cancel();
    },
  };
}
