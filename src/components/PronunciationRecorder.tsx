import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { audioTypes, maxRecordingBytes, saveRecording, type RecordingDraft } from "../lib/pronunciation";

const maxDurationSeconds = 60;
// The recording no longer asks the user for a practice word. Keep a meaningful label
// for the existing database schema (which requires a non-empty practice field).
const recordingLabel = "Gravação de pronúncia";
const microphoneError = "Erro no microfone. Confira se ele está conectado e habilite o acesso no navegador para tentar novamente.";

export function useClipUrl(audio: Blob | undefined) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!audio) {
      setUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(audio);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [audio]);
  return audio ? url : "";
}

export function PronunciationRecorder({
  patientId, retentionDays, onSaved,
}: {
  patientId?: string;
  retentionDays?: number | null;
  onSaved?: () => void;
}) {
  const active = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const [phase, setPhase] = useState<"idle" | "request" | "recording" | "stopping">("idle");
  const [playing, setPlaying] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [draft, setDraft] = useState<RecordingDraft>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const url = useClipUrl(draft?.audio);
  const busy = phase !== "idle" || saving;

  useEffect(() => {
    function stopWhenHidden() {
      if (document.hidden) stop();
    }
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      generation.current++;
      window.clearTimeout(timer.current);
      const current = active.current;
      if (current?.state === "recording") current.stop();
      current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function stop() {
    const current = active.current;
    if (current?.state !== "recording") return;
    setPhase("stopping");
    current.stop();
  }

  async function start() {
    if (busy || (patientId && !authorized)) return;
    const token = ++generation.current;
    setPhase("request");
    setError("");
    setFeedback("");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (token !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (document.hidden) {
        stream.getTracks().forEach((track) => track.stop());
        setPhase("idle");
        return;
      }
      const type = audioTypes.find((format) => MediaRecorder.isTypeSupported(format));
      const recorder = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 64_000 });
      const chunks: Blob[] = [];
      let failed = false;
      active.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        failed = true;
        recorder.stream.getTracks().forEach((track) => track.stop());
        if (token !== generation.current) return;
        window.clearTimeout(timer.current);
        active.current = null;
        setPhase("idle");
        setError(microphoneError);
      };
      recorder.onstop = () => {
        recorder.stream.getTracks().forEach((track) => track.stop());
        if (token !== generation.current || failed) return;
        window.clearTimeout(timer.current);
        active.current = null;
        setPhase("idle");
        const audio = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type });
        if (!audio.size || audio.size > maxRecordingBytes) {
          setError("O áudio está vazio ou ultrapassou o limite de 2 MB. Grave um trecho mais curto e tente novamente.");
          return;
        }
        if (patientId && !audioTypes.includes(audio.type.split(";")[0])) {
          setError("O formato de áudio deste navegador não pode ser salvo.");
          return;
        }
        setDraft({ id: crypto.randomUUID(), practice: recordingLabel, audio });
      };
      recorder.start();
      setPlaying(false);
      setPhase("recording");
      timer.current = window.setTimeout(stop, maxDurationSeconds * 1000);
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      if (token !== generation.current) return;
      active.current = null;
      setPhase("idle");
      setError(microphoneError);
    }
  }

  async function save() {
    if (!patientId || !draft || !authorized || busy) return;
    setError("");
    setSaving(true);
    const token = generation.current;
    try {
      await saveRecording(patientId, draft, authorized);
      if (token !== generation.current) return;
      setDraft(undefined);
      setAuthorized(false);
      setPlaying(false);
      setFeedback("Gravação salva.");
      onSaved?.();
    } catch (problem) {
      if (token === generation.current) setError(problem instanceof Error ? problem.message : "Não foi possível salvar a gravação.");
    } finally {
      if (token === generation.current) setSaving(false);
    }
  }

  const status = phase === "request" ? "Aguardando permissão do microfone…"
    : phase === "recording" ? "Gravando."
    : phase === "stopping" ? "Finalizando a gravação…"
    : playing ? "Reproduzindo."
    : draft ? "Gravação finalizada."
    : "Pronto para gravar.";

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    return <p className="text-sm text-stone-700">A gravação precisa de um navegador com acesso ao microfone e de uma conexão segura.</p>;
  }

  return (
    <div className="space-y-3">
      {patientId && (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={authorized} disabled={busy}
            onChange={(event) => setAuthorized(event.target.checked)} />
          Autorizo gravar e salvar o áudio privado neste perfil por até {retentionDays} dias.
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {phase === "recording" ? (
          <button type="button" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-red-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-800" onClick={stop}>
            <Square aria-hidden="true" size={16} fill="currentColor" /> Parar gravação
          </button>
        ) : (
          <button type="button" className="button-primary" disabled={busy || Boolean(patientId && !authorized)} onClick={() => void start()}>
            <Mic aria-hidden="true" size={18} /> {draft ? "Gravar novamente" : "Gravar pronúncia"}
          </button>
        )}
        <p role="status" className="text-sm text-stone-700">{status}</p>
      </div>
      {draft && phase === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          <audio className="max-w-full" controls src={url} aria-label="Prévia da gravação de pronúncia"
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            onError={() => {
              setPlaying(false);
              setError("Não foi possível reproduzir a prévia neste navegador.");
            }} />
          {patientId && (
            <button type="button" className="button-primary" disabled={!authorized || saving} onClick={() => void save()}>
              {saving ? "Salvando…" : "Salvar gravação"}
            </button>
          )}
          <button type="button" className="button-secondary" disabled={saving} onClick={() => {
            setDraft(undefined);
            setPlaying(false);
            setError("");
            setFeedback("Gravação descartada.");
          }}>Descartar áudio</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
      {feedback && <p role="status" className="text-sm text-stone-700">{feedback}</p>}
    </div>
  );
}
