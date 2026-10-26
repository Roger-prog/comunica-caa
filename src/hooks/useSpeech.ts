import { useCallback, useEffect, useRef, useState } from "react";

export interface SpeechOptions {
  voiceURI?: string;
  rate?: number;
  volume?: number;
}

/** Browser speech remains synchronous with the user's gesture, including on Safari. */
export function useSpeech() {
  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function";
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!supported) return;

    const synthesis = window.speechSynthesis;
    const loadVoices = () => setVoices(synthesis.getVoices());
    loadVoices();
    synthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      synthesis.removeEventListener("voiceschanged", loadVoices);
      generation.current += 1;
      currentUtterance.current = null;
      synthesis.cancel();
    };
  }, [supported]);

  const stop = useCallback(() => {
    generation.current += 1;
    currentUtterance.current = null;
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string, options: SpeechOptions = {}) => {
      const message = text.trim();
      if (!message) return;
      if (!supported) {
        setError(
          "A leitura em voz alta não está disponível neste navegador. O texto continua visível na prancha.",
        );
        return;
      }

      const synthesis = window.speechSynthesis;
      const request = ++generation.current;
      // Invalidate previous callbacks before cancel(), which can emit an error event.
      currentUtterance.current = null;
      synthesis.cancel();
      setError(null);

      const utterance = new window.SpeechSynthesisUtterance(message);
      const available = synthesis.getVoices();
      const voice =
        available.find((item) => item.voiceURI === options.voiceURI) ??
        available.find((item) => /^pt[-_]BR$/i.test(item.lang)) ??
        available.find((item) => /^pt(?:[-_]|$)/i.test(item.lang));
      utterance.lang = voice?.lang ?? "pt-BR";
      if (voice) utterance.voice = voice;
      utterance.rate = Math.min(1.5, Math.max(0.5, options.rate ?? 1));
      utterance.volume = Math.min(1, Math.max(0, options.volume ?? 1));
      utterance.onend = () => {
        if (generation.current !== request) return;
        currentUtterance.current = null;
        setSpeaking(false);
      };
      utterance.onerror = (event) => {
        if (generation.current !== request) return;
        currentUtterance.current = null;
        setSpeaking(false);
        if (event.error === "canceled" || event.error === "interrupted") return;
        setError(
          event.error === "not-allowed"
            ? "O navegador bloqueou o áudio. Toque novamente em um símbolo para iniciar a leitura."
            : "Não foi possível reproduzir a voz. Confira o áudio do dispositivo e tente outra voz em Ajustes.",
        );
      };
      // Retain the utterance while native speech is running.
      currentUtterance.current = utterance;
      setSpeaking(true);
      try {
        synthesis.speak(utterance);
      } catch {
        currentUtterance.current = null;
        setSpeaking(false);
        setError(
          "Não foi possível iniciar a leitura. Confira o áudio do dispositivo e tente novamente.",
        );
      }
    },
    [supported],
  );

  return { supported, voices, speaking, error, speak, stop };
}
