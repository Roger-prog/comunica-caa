import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWebSpeechEngine,
  LOCAL_SPEECH_VOICE,
  type SpeechEngine,
  type SpeechFailure,
  type SpeechOptions,
  type SpeechVoice,
} from "../lib/speechEngine";
import { createEdgeSpeechEngine } from "../lib/edgeSpeechEngine";

export type { SpeechOptions } from "../lib/speechEngine";

type PlaybackOptions = SpeechOptions & { onStart?: () => void };

/** Coordinates neural recordings and local Brazilian Portuguese speech. */
export function useSpeech(engine?: SpeechEngine) {
  const [defaultEngine] = useState(() =>
    createEdgeSpeechEngine(
      import.meta.env.VITE_TTS_API_URL?.trim() || "/api/tts",
    ),
  );
  const selectedEngine = engine ?? defaultEngine;
  const [deviceEngine] = useState(createWebSpeechEngine);
  const supported = selectedEngine.supported || (selectedEngine === defaultEngine && deviceEngine.supported);
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsPlaybackGesture, setNeedsPlaybackGesture] = useState(false);
  const generation = useRef(0);
  const deviceInUse = useRef(false);
  const prefetches = useRef(new Set<() => void>());

  useEffect(() => {
    setSpeaking(false);
    setError(null);
    setNotice(null);
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
      if (!supported || options.voiceURI === LOCAL_SPEECH_VOICE || !selectedEngine.prefetch) return () => {};
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
      if (!texts.length || !supported || options.voiceURI === LOCAL_SPEECH_VOICE || !selectedEngine.prepareSentence)
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
    setNotice(null);
  }, [deviceEngine, selectedEngine]);

  const speak = useCallback(
    (text: string, { onStart, ...options }: PlaybackOptions = {}) => {
      const message = text.trim();
      if (!message) return;
      if (!supported) {
        setError(
          "A leitura em voz alta não está disponível neste navegador. O texto continua visível na prancha.",
        );
        return;
      }

      const localPreferred = options.voiceURI === LOCAL_SPEECH_VOICE;
      const wantsDevice = localPreferred || Boolean(options.offlineOnly &&
        !selectedEngine.canPlayOffline?.(message, options));
      const localVoice = wantsDevice ? deviceEngine.getVoices()[0] : undefined;
      const useDevice = Boolean(localVoice);
      const bundledFallback = localPreferred && !useDevice
        ? { ...options, voiceURI: undefined, offlineOnly: true } : null;
      if (wantsDevice && !useDevice &&
          !(bundledFallback && selectedEngine.canPlayOffline?.(message, bundledFallback))) {
        stop();
        setError("Para ouvir esta mensagem, habilite uma voz local em português do Brasil no seu dispositivo e toque novamente.");
        return;
      }

      const request = ++generation.current;
      // Invalidate previous callbacks before cancel(), which can emit an error event.
      selectedEngine.cancel();
      if (deviceInUse.current) deviceEngine.cancel();
      deviceInUse.current = useDevice;
      setError(null);
      setNeedsPlaybackGesture(false);
      const voices = selectedEngine.getVoices();
      const chosenName = (options.voiceURI ? voices.find((voice) => voice.voiceURI === options.voiceURI) : voices[0])?.name;
      if (bundledFallback) {
        setNotice("A voz local em português do Brasil está indisponível. Usando a gravação de " +
          (voices[0]?.name ?? "português do Brasil") + ".");
      } else {
        setNotice(localVoice && !localPreferred
          ? `A voz ${chosenName ?? "configurada"} está indisponível para este texto. Usando a voz local ${localVoice.name} (português do Brasil).`
          : null);
      }

      let started = false;
      const onPlaybackStart = () => {
        if (generation.current !== request || started) return;
        started = true;
        onStart?.();
      };
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
            : useDevice || options.offlineOnly
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
        const playback = (useDevice ? deviceEngine : selectedEngine).speak(message, localVoice
          ? { ...options, voiceURI: localVoice.voiceURI }
          : bundledFallback ?? options, {
          onStart: onPlaybackStart,
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
    notice,
    speak,
    stop,
    needsPlaybackGesture,
    retryPlayback,
    prefetch,
    prepareSentence,
  };
}
