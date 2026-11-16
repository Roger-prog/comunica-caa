import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWebSpeechEngine,
  type SpeechEngine,
  type SpeechFailure,
  type SpeechOptions,
  type SpeechVoice,
} from "../lib/speechEngine";
import { createEdgeSpeechEngine } from "../lib/edgeSpeechEngine";

export type { SpeechOptions } from "../lib/speechEngine";

/** Coordinates UI state; the default engine fetches MP3 and plays a local Blob URL. */
export function useSpeech(engine?: SpeechEngine) {
  const [defaultEngine] = useState(() =>
    createEdgeSpeechEngine(
      import.meta.env.VITE_TTS_API_URL?.trim() || "/api/tts",
    ),
  );
  const selectedEngine = engine ?? defaultEngine;
  const [deviceEngine] = useState(() => createWebSpeechEngine(true));
  const supported = selectedEngine.supported;
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPlaybackGesture, setNeedsPlaybackGesture] = useState(false);
  const generation = useRef(0);
  const deviceInUse = useRef(false);
  const prefetches = useRef(new Set<() => void>());

  useEffect(() => {
    setSpeaking(false);
    setError(null);
    setNeedsPlaybackGesture(false);
    const loadVoices = () => setVoices(selectedEngine.getVoices());
    loadVoices();
    const unsubscribe = selectedEngine.subscribeVoices(loadVoices);

    return () => {
      unsubscribe();
      generation.current += 1;
      for (const cancel of prefetches.current) cancel();
      selectedEngine.cancel();
      if (deviceInUse.current) deviceEngine.cancel();
      deviceInUse.current = false;
      // Release session-scoped blobs and pending downloads on engine/user exit.
      // clearCache remains reusable during React StrictMode's cleanup cycle.
      selectedEngine.clearCache?.();
    };
  }, [deviceEngine, selectedEngine]);

  const prefetch = useCallback(
    (texts: readonly string[], options: SpeechOptions = {}): (() => void) => {
      if (!supported || !selectedEngine.prefetch) return () => {};
      try {
        // The engine belongs to this hook instance: downloaded Blobs stay in RAM
        // and are reused by speak(), without React renders or persistent storage.
        const release = selectedEngine.prefetch(texts, options);
        let active = true;
        const cancel = () => {
          if (!active) return;
          active = false;
          prefetches.current.delete(cancel);
          release();
        };
        prefetches.current.add(cancel);
        return cancel;
      } catch {
        // A background optimization must not prevent using the board or speak().
        return () => {};
      }
    },
    [selectedEngine, supported],
  );

  const prepareSentence = useCallback(
    (texts: readonly string[], options: SpeechOptions = {}): (() => void) => {
      if (!texts.length || !supported || !selectedEngine.prepareSentence)
        return () => {};
      try {
        const release = selectedEngine.prepareSentence(texts, options);
        let active = true;
        const cancel = () => {
          if (!active) return;
          active = false;
          prefetches.current.delete(cancel);
          release();
        };
        prefetches.current.add(cancel);
        return cancel;
      } catch {
        // Preparing audio must not play it or block editing the sentence.
        return () => {};
      }
    },
    [selectedEngine, supported],
  );

  const stop = useCallback(() => {
    generation.current += 1;
    selectedEngine.cancel();
    if (deviceInUse.current) deviceEngine.cancel();
    deviceInUse.current = false;
    setSpeaking(false);
    setNeedsPlaybackGesture(false);
    setError(null);
  }, [deviceEngine, selectedEngine]);

  const speak = useCallback(
    (text: string, options: SpeechOptions = {}) => {
      const message = text.trim();
      if (!message) return;
      const useDevice = options.deviceOnly ||
        (options.preferDevice && deviceEngine.getVoices().length > 0);
      if (options.deviceOnly && !deviceEngine.getVoices().length) {
        stop();
        setError("Para ouvir esta mensagem, habilite uma voz local em português do Brasil no seu dispositivo.");
        return;
      }
      if (!supported && !useDevice) {
        setError(
          "A leitura em voz alta não está disponível neste navegador. O texto continua visível na prancha.",
        );
        return;
      }

      const request = ++generation.current;
      // Invalidate previous callbacks before cancel(), which can emit an error event.
      selectedEngine.cancel();
      if (deviceInUse.current) deviceEngine.cancel();
      deviceInUse.current = Boolean(useDevice);
      setError(null);
      setNeedsPlaybackGesture(false);

      const onEnd = () => {
        if (generation.current !== request) return;
        setSpeaking(false);
        setNeedsPlaybackGesture(false);
      };
      const onError = (reason: SpeechFailure) => {
        if (generation.current !== request) return;
        setSpeaking(false);
        if (reason === "canceled" || reason === "interrupted") return;
        setNeedsPlaybackGesture(
          !useDevice && reason === "not-allowed" && Boolean(selectedEngine.retryPlayback),
        );
        setError(
          reason === "not-allowed" && !useDevice
            ? "O áudio está pronto. Toque em Ouvir áudio pronto para reproduzir."
            : useDevice || options.bundledOnly
              ? "Não foi possível reproduzir o áudio neste dispositivo. Confira as configurações de som."
              : "Não foi possível gerar ou reproduzir a voz. Verifique a conexão e se o serviço de voz está disponível.",
        );
      };
      setSpeaking(true);
      const failedToStart = () => {
        if (generation.current !== request) return;
        setSpeaking(false);
        setNeedsPlaybackGesture(false);
        setError(
          "Não foi possível iniciar a leitura. Confira o áudio do dispositivo e tente novamente.",
        );
      };
      try {
        // Start the request immediately; the engine plays the returned Blob
        // without a second download or a media-readiness event barrier.
        const playback = (useDevice ? deviceEngine : selectedEngine).speak(message, options, {
          onEnd,
          onError,
        });
        if (playback) void Promise.resolve(playback).catch(failedToStart);
      } catch {
        failedToStart();
      }
    },
    [deviceEngine, selectedEngine, stop, supported],
  );

  const retryPlayback = useCallback(() => {
    if (!needsPlaybackGesture || !selectedEngine.retryPlayback) return;
    const request = generation.current;
    setError(null);
    setNeedsPlaybackGesture(false);
    setSpeaking(true);
    const failed = () => {
      if (generation.current !== request) return;
      setSpeaking(false);
      setError(
        "Não foi possível reproduzir o áudio. Selecione o símbolo novamente.",
      );
    };
    try {
      // Replay the already generated MP3 during this new user gesture; no fetch.
      const playback = selectedEngine.retryPlayback();
      if (playback) void Promise.resolve(playback).catch(failed);
    } catch {
      failed();
    }
  }, [needsPlaybackGesture, selectedEngine]);

  return {
    supported,
    voices,
    speaking,
    error,
    speak,
    stop,
    needsPlaybackGesture,
    retryPlayback,
    prefetch,
    prepareSentence,
  };
}
