import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
type RecoveryAction = "audio-ready" | "synthesis";
type SpeechAttempt = { text: string; options: SpeechOptions; notifyStart: () => void };

function reportNeuralFailure(code: "unavailable" | "playback" | "runtime" | "local-model" | "local-inference" | "local-timeout") {
  if (import.meta.env.MODE !== "test") console.warn("[Comunica/Speech] Voz neural local", code);
}

/** Coordinates neural playback and device speech selected explicitly by the user. */
export function useSpeech(engine?: SpeechEngine, scopeKey?: string) {
  const [defaultEngine] = useState(() => createEdgeSpeechEngine(null));
  const selectedEngine = engine ?? defaultEngine;
  const [deviceEngine] = useState(createWebSpeechEngine);
  const supported = selectedEngine.supported || (selectedEngine === defaultEngine && deviceEngine.supported);
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recovery, setRecoveryState] = useState<{ action: RecoveryAction } | null>(null);
  const activeRecovery = useRef(recovery);
  const [deviceVoiceAvailable, setDeviceVoiceAvailable] = useState(false);
  const generation = useRef(0);
  const deviceInUse = useRef(false);
  const prefetches = useRef(new Set<() => void>());
  const attempt = useRef<SpeechAttempt | null>(null);

  const setRecovery = useCallback((action: RecoveryAction | null) => {
    const next = action ? { action } : null;
    activeRecovery.current = next;
    setRecoveryState(next);
  }, []);

  const cancelPlayback = useCallback(() => {
    generation.current += 1;
    selectedEngine.cancel();
    if (deviceInUse.current) deviceEngine.cancel();
    deviceInUse.current = false;
  }, [deviceEngine, selectedEngine]);

  useLayoutEffect(() => {
    setSpeaking(false);
    setPreparing(false);
    setError(null);
    setNotice(null);
    setRecovery(null);
    const loadVoices = () => setVoices(selectedEngine.getVoices());
    const loadDeviceVoice = () => setDeviceVoiceAvailable(deviceEngine.getVoices().length > 0);
    loadVoices();
    loadDeviceVoice();
    const unsubscribe = selectedEngine.subscribeVoices(loadVoices);
    const unsubscribeDevice = deviceEngine.subscribeVoices(loadDeviceVoice);

    return () => {
      unsubscribe();
      unsubscribeDevice();
      activeRecovery.current = null;
      attempt.current = null;
      cancelPlayback();
      for (const cancel of prefetches.current) cancel();
      selectedEngine.clearCache?.();
    };
  }, [cancelPlayback, deviceEngine, selectedEngine, setRecovery, scopeKey]);

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
    cancelPlayback();
    attempt.current = null;
    setSpeaking(false);
    setPreparing(false);
    setRecovery(null);
    setError(null);
    setNotice(null);
  }, [cancelPlayback, setRecovery]);

  const start = useCallback((pending: SpeechAttempt, useDevice: boolean) => {
    cancelPlayback();
    const request = generation.current;
    const { text, options } = pending;
    attempt.current = pending;
    setPreparing(false);
    setError(null);
    setRecovery(null);
    setNotice(null);

    const localVoice = useDevice ? deviceEngine.getVoices()[0] : undefined;
    if (useDevice && !localVoice) {
      setSpeaking(false);
      setDeviceVoiceAvailable(false);
      setError("Para usar a voz do dispositivo, habilite uma voz local em português do Brasil e tente novamente.");
      if (options.voiceURI !== LOCAL_SPEECH_VOICE) setRecovery("synthesis");
      else attempt.current = null;
      return;
    }
    if (!selectedEngine.supported && !useDevice) {
      setSpeaking(false);
      if (supported) setRecovery("synthesis");
      else attempt.current = null;
      setError("A voz neural local não está disponível neste navegador. O texto continua visível na prancha.");
      return;
    }

    const target = localVoice ? deviceEngine : selectedEngine;
    deviceInUse.current = Boolean(localVoice);
    if (localVoice && options.voiceURI !== LOCAL_SPEECH_VOICE) {
      setNotice(`Usando a voz do dispositivo ${localVoice.name} (português do Brasil) para esta leitura.`);
    }
    if (!useDevice && options.offlineOnly && selectedEngine.canPlayOffline?.(text, options) === false) {
      reportNeuralFailure("unavailable");
      setSpeaking(false);
      setDeviceVoiceAvailable(deviceEngine.getVoices().length > 0);
      setRecovery("synthesis");
      setError("A voz selecionada não está disponível para este texto. Escolha uma voz neural local nos ajustes da prancha.");
      return;
    }

    const onPlaybackStart = () => {
      if (generation.current !== request) return;
      setPreparing(false);
      pending.notifyStart();
    };
    const onEnd = () => {
      if (generation.current !== request) return;
      generation.current += 1;
      attempt.current = null;
      setSpeaking(false);
      setPreparing(false);
      setRecovery(null);
    };
    const onError = (reason: SpeechFailure, runtimeFailure = false) => {
      if (generation.current !== request) return;
      setSpeaking(false);
      setPreparing(false);
      if (!useDevice && reason === "not-allowed" && selectedEngine.retryPlayback) {
        setRecovery("audio-ready");
        setError("O áudio está pronto. Toque em Ouvir áudio pronto para reproduzir.");
        return;
      }
      generation.current += 1;
      if (reason === "canceled" || reason === "interrupted") {
        attempt.current = null;
        setRecovery(null);
        return;
      }
      if (!useDevice || options.voiceURI !== LOCAL_SPEECH_VOICE) {
        setDeviceVoiceAvailable(deviceEngine.getVoices().length > 0);
        setRecovery("synthesis");
      } else {
        attempt.current = null;
      }
      if (!useDevice) reportNeuralFailure(reason === "failed" || reason === "not-allowed"
        ? runtimeFailure ? "runtime" : "playback" : reason);
      setError(useDevice
        ? "Não foi possível reproduzir a voz do dispositivo. Confira as configurações de som."
        : reason === "local-model" || reason === "local-timeout"
          ? "Não foi possível carregar a voz neural local. Verifique a conexão para baixar o modelo e tente novamente."
          : "Não foi possível gerar ou reproduzir a voz neural local. Tente repetir a síntese.");
    };
    setSpeaking(true);
    setPreparing(!useDevice);
    const failedToStart = () => onError("failed", true);
    try {
      const playback = target.speak(text, localVoice
        ? { ...options, voiceURI: localVoice.voiceURI }
        : options, {
        onStart: onPlaybackStart,
        onEnd,
        onError,
      });
      if (playback) void Promise.resolve(playback).catch(failedToStart);
    } catch {
      failedToStart();
    }
  }, [cancelPlayback, deviceEngine, selectedEngine, setRecovery, supported]);

  const speak = useCallback((text: string, { onStart, ...options }: PlaybackOptions = {}) => {
    const message = text.trim();
    if (!message) return;
    let started = false;
    start({ text: message, options, notifyStart: () => {
      if (started) return;
      started = true;
      onStart?.();
    } }, options.voiceURI === LOCAL_SPEECH_VOICE);
  }, [start]);

  const retrySynthesis = useCallback(() => {
    if (recovery?.action === "synthesis" && activeRecovery.current === recovery && attempt.current) {
      start(attempt.current, false);
    }
  }, [recovery, start]);

  const fallbackToDevice = useCallback(() => {
    if (recovery?.action === "synthesis" && activeRecovery.current === recovery && attempt.current) {
      start(attempt.current, true);
    }
  }, [recovery, start]);

  const retryPlayback = useCallback(() => {
    if (recovery?.action !== "audio-ready" || activeRecovery.current !== recovery ||
        !attempt.current || !selectedEngine.retryPlayback) return;
    const request = generation.current;
    setError(null);
    setRecovery(null);
    setSpeaking(true);
    const failed = () => {
      if (generation.current !== request) return;
      generation.current += 1;
      selectedEngine.cancel();
      setSpeaking(false);
      setRecovery("synthesis");
      setDeviceVoiceAvailable(deviceEngine.getVoices().length > 0);
      reportNeuralFailure("playback");
      setError("Não foi possível reproduzir o áudio. Tente repetir a síntese.");
    };
    try {
      // Replay the existing audio directly during this gesture, without synthesis.
      const playback = selectedEngine.retryPlayback();
      if (playback) void Promise.resolve(playback).catch(failed);
    } catch {
      failed();
    }
  }, [deviceEngine, recovery, selectedEngine, setRecovery]);

  return {
    supported,
    voices,
    speaking,
    preparing,
    error,
    notice,
    speak,
    stop,
    needsPlaybackGesture: recovery?.action === "audio-ready",
    retryPlayback,
    canRetrySynthesis: recovery?.action === "synthesis",
    retrySynthesis,
    canFallbackToDevice: recovery?.action === "synthesis" && deviceVoiceAvailable,
    fallbackToDevice,
    prefetch,
    prepareSentence,
  };
}
