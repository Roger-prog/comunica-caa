export const LOCAL_SPEECH_VOICE = "local-pt-BR";

export interface SpeechOptions {
  voiceURI?: string;
  rate?: number;
  volume?: number;
  segments?: readonly string[];
  offlineOnly?: boolean;
}

export interface SpeechVoice {
  voiceURI: string;
  name: string;
  lang: string;
}

export type SpeechFailure =
  "canceled" | "interrupted" | "not-allowed" | "failed";

export interface SpeechCallbacks {
  onStart?: () => void;
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
  canPlayOffline?: (text: string, options: SpeechOptions) => boolean;
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
  const getVoices = () => (synthesis?.getVoices() ?? [])
    .filter((voice) => voice.localService && /^pt[-_]BR$/i.test(voice.lang))
    .sort((a, b) => Number(b.default) - Number(a.default) ||
      a.name.localeCompare(b.name, "pt-BR") || a.voiceURI.localeCompare(b.voiceURI));

  return {
    supported,
    getVoices,
    canPlayOffline: () => getVoices().length > 0,
    subscribeVoices(listener) {
      synthesis?.addEventListener("voiceschanged", listener);
      return () => synthesis?.removeEventListener("voiceschanged", listener);
    },
    speak(text, options, callbacks) {
      if (!synthesis) throw new Error("speech_unavailable");
      const voices = getVoices();
      const voice = voices.find((item) => item.voiceURI === options.voiceURI) ?? voices[0];
      if (!voice) {
        callbacks.onError("failed");
        return;
      }
      const chunks: string[] = [];
      let remaining = text.trim();
      while (remaining.length > 140) {
        let boundary = remaining.lastIndexOf(" ", 140);
        if (boundary < 1) boundary = remaining.indexOf(" ", 140);
        if (boundary < 1) break;
        chunks.push(remaining.slice(0, boundary));
        remaining = remaining.slice(boundary + 1).trimStart();
      }
      if (remaining) chunks.push(remaining);
      if (!chunks.length) { callbacks.onEnd(); return; }
      function playChunk(index: number) {
        const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
        utterance.lang = "pt-BR";
        utterance.voice = voice;
        utterance.rate = bounded(options.rate, 1, 0.5, 1.5);
        utterance.volume = bounded(options.volume, 1, 0, 1);
        utterance.onstart = () => {
          if (currentUtterance !== utterance || index !== 0) return;
          callbacks.onStart?.();
        };
        utterance.onend = () => {
          if (currentUtterance !== utterance) return;
          currentUtterance = null;
          if (index + 1 < chunks.length) playChunk(index + 1);
          else callbacks.onEnd();
        };
        utterance.onerror = (event) => {
          if (currentUtterance !== utterance) return;
          currentUtterance = null;
          const reason = event.error;
          callbacks.onError(reason === "not-allowed" || reason === "canceled" || reason === "interrupted" ? reason : "failed");
        };
        currentUtterance = utterance;
        try { synthesis!.speak(utterance); }
        catch {
          currentUtterance = null;
          callbacks.onError("failed");
        }
      }
      playChunk(0);
    },
    cancel() {
      if (currentUtterance) {
        currentUtterance.onstart = null;
        currentUtterance.onend = null;
        currentUtterance.onerror = null;
        currentUtterance = null;
      }
      synthesis?.cancel();
    },
  };
}
