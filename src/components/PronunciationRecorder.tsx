import { useEffect, useRef, useState } from "react";

export function PronunciationRecorder() {
  const recorder = useRef<MediaRecorder | null>(null);
  const generation = useRef(0);
  const [phase, setPhase] = useState<"idle" | "request" | "recording">("idle");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => () => {
    generation.current++;
    const current = recorder.current;
    if (current?.state === "recording") current.stop();
    current?.stream.getTracks().forEach(track => track.stop());
  }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function start() {
    const token = ++generation.current;
    setPhase("request");
    setError("");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== generation.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const current = new MediaRecorder(stream);
      recorder.current = current;
      const chunks: Blob[] = [];
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onstop = () => {
        current.stream.getTracks().forEach(track => track.stop());
        if (generation.current !== token) return;
        recorder.current = null;
        setPhase("idle");
        if (chunks.length) setUrl(URL.createObjectURL(new Blob(chunks, { type: current.mimeType })));
      };
      current.start();
      setPhase("recording");
    } catch {
      stream?.getTracks().forEach(track => track.stop());
      if (generation.current !== token) return;
      setPhase("idle");
      setError("Não foi possível gravar. Confira o microfone e a permissão do navegador.");
    }
  }
  return <section className="surface space-y-3 p-5">
    <h2 className="text-xl">Escuta da pronúncia</h2>
    <p>Grave uma palavra para escutar e analisar a pronúncia. O áudio fica neste dispositivo até você sair desta tela.</p>
    <button className="button-secondary" disabled={phase === "request"} onClick={() => {
      if (phase === "recording") recorder.current?.stop();
      else void start();
    }}>{phase === "recording" ? "Parar gravação" : phase === "request" ? "Aguardando microfone…" : "Gravar pronúncia"}</button>
    {url && <div className="flex flex-wrap gap-2"><audio className="max-w-full" controls src={url} /><button className="button-secondary" onClick={() => setUrl("")}>Descartar áudio</button></div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
