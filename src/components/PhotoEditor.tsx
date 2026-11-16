import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { prepareBoardPhoto, renderBoardPhoto } from "../lib/patientBoardPhoto";

export function PhotoEditor({ onPhoto, setBusy, disabled }: { onPhoto: (photo: Blob) => void; setBusy: (busy: boolean) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const capture = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const live = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [square, setSquare] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    generation.current++;
    live.current?.getTracks().forEach((track) => track.stop());
    live.current = null;
  }, []);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  function stopCamera() {
    live.current?.getTracks().forEach((track) => track.stop());
    live.current = null;
    setStream(null);
    setCameraReady(false);
  }

  async function process(image: () => Promise<Blob>) {
    const request = ++generation.current;
    setPending(true);
    setBusy(true);
    setError(null);
    try {
      const result = await image();
      if (generation.current !== request) return;
      stopCamera();
      onPhoto(result);
    } catch (failure) {
      if (generation.current === request) setError(failure instanceof Error ? failure.message : "Não foi possível preparar a foto.");
    } finally {
      if (generation.current === request) {
        setPending(false);
        setBusy(false);
      }
    }
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      capture.current?.click();
      return;
    }
    const request = ++generation.current;
    setPending(true);
    setBusy(true);
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (generation.current !== request) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      live.current = media;
      setStream(media);
    } catch {
      if (generation.current === request) setError("A câmera não está disponível. Verifique a permissão do navegador ou escolha uma imagem do dispositivo.");
    } finally {
      if (generation.current === request) {
        setPending(false);
        setBusy(false);
      }
    }
  }

  function fromInput(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (file) void process(() => prepareBoardPhoto(file, square));
  }

  return (
    <div className="space-y-3">
      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={square} disabled={disabled || pending} onChange={(event) => setSquare(event.target.checked)} className="size-4 accent-brand-600" />
        Recortar a foto em um quadrado
      </label>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => fromInput(event.currentTarget)} />
      <input ref={capture} type="file" accept="image/*" capture="environment" hidden onChange={(event) => fromInput(event.currentTarget)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="button-secondary" onClick={() => input.current?.click()} disabled={disabled || pending}>
          <ImagePlus size={17} aria-hidden="true" /> Enviar imagem
        </button>
        {!stream && <button type="button" className="button-secondary" onClick={() => void openCamera()} disabled={disabled || pending}>
          <Camera size={17} aria-hidden="true" /> Usar câmera
        </button>}
      </div>
      {stream && <div className="space-y-2">
        <video ref={video} autoPlay muted playsInline onLoadedData={() => setCameraReady(true)} aria-label="Imagem da câmera" className="aspect-video max-h-60 w-full rounded-xl bg-black object-contain" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button-primary" disabled={!cameraReady || disabled || pending} onClick={() => {
            const frame = video.current;
            if (frame) void process(() => renderBoardPhoto(frame, frame.videoWidth, frame.videoHeight, square));
          }}>Tirar foto</button>
          <button type="button" className="button-secondary" onClick={stopCamera} disabled={pending}><X size={17} aria-hidden="true" /> Fechar câmera</button>
        </div>
      </div>}
      {pending && <p role="status" className="text-sm text-stone-600">Preparando imagem ou câmera…</p>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </div>
  );
}
