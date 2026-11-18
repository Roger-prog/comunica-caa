import { Volume2 } from "lucide-react";
import type { useSpeech } from "../hooks/useSpeech";

type Feedback = Pick<ReturnType<typeof useSpeech>,
  "preparing" | "notice" | "error" | "needsPlaybackGesture" | "retryPlayback"
  | "canRetrySynthesis" | "retrySynthesis" | "canFallbackToDevice" | "fallbackToDevice">;

export function SpeechFeedback({ speech, compact = false }: { speech: Feedback; compact?: boolean }) {
  const button = compact ? "board-control" : "button-secondary";
  const hasAction = speech.needsPlaybackGesture || speech.canRetrySynthesis || speech.canFallbackToDevice;
  if (!speech.preparing && !speech.notice && !speech.error && !hasAction) return null;

  return <div className="mt-2 space-y-2">
    {speech.preparing && <p role="status" className="text-sm text-stone-600">Preparando o áudio no dispositivo…</p>}
    {speech.notice && <p role="status" className="rounded-xl bg-brand-50 p-2 text-sm text-brand-800">{speech.notice}</p>}
    {speech.error && <p role="alert" className="rounded-xl bg-red-50 p-2 text-sm text-red-800">{speech.error}</p>}
    {hasAction && <div className="flex flex-wrap gap-2">
      {speech.needsPlaybackGesture && <button type="button" className={button} onClick={speech.retryPlayback}>
        <Volume2 size={17} aria-hidden="true" /> Ouvir áudio pronto
      </button>}
      {speech.canRetrySynthesis && <button type="button" className={button} onClick={speech.retrySynthesis}>
        Tentar voz neural novamente
      </button>}
      {speech.canFallbackToDevice && <button type="button" className={button} onClick={speech.fallbackToDevice}>
        Ouvir com voz do dispositivo
      </button>}
    </div>}
  </div>;
}
