import { useEffect, useId, useRef, useState } from "react";

export function LibrasPanel() {
  const [status, setStatus] = useState<"closed" | "loading" | "ready" | "error">("closed");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const open = status !== "closed";

  useEffect(() => {
    if (status !== "loading" && status !== "ready") return;
    const timeout = status === "loading" ? window.setTimeout(() => setStatus("error"), 12_000) : undefined;
    function receiveStatus(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== "null") return;
      if (event.data?.type !== "comunica-vlibras") return;
      if (event.data.status === "ready" || event.data.status === "error") setStatus(event.data.status);
    }
    window.addEventListener("message", receiveStatus);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receiveStatus);
    };
  }, [status]);

  function close() {
    setStatus("closed");
    toggleRef.current?.focus();
  }

  return (
    <section className="my-2 w-full" aria-label="Libras">
      <button ref={toggleRef} type="button" className="button-secondary" aria-expanded={open} aria-controls={panelId}
        onClick={() => open ? close() : setStatus("loading")}>
        {open ? "Desativar Libras" : "Ativar Libras"}
      </button>
      <div id={panelId} hidden={!open} className="mt-2 space-y-2">
        <p className="text-sm">O intérprete automático traduz o guia público abaixo. Para atendimentos clínicos, conte com um intérprete profissional.</p>
        {status === "loading" && <p role="status">Carregando o intérprete de Libras…</p>}
        {(status === "loading" || status === "ready") && (
          <iframe ref={frameRef} sandbox="allow-scripts" referrerPolicy="no-referrer"
            title="Intérprete VLibras" className="h-[42rem] w-full rounded-2xl border-2 lg:h-[29rem]" src="/vlibras.html" />
        )}
        {status === "error" && (
          <div role="status">
            <p>O intérprete está indisponível no momento.</p>
            <button type="button" className="button-secondary" onClick={() => setStatus("loading")}>Tentar novamente</button>
          </div>
        )}
        <a className="inline-flex min-h-11 items-center underline" href="https://www.vlibras.gov.br/doc/widget/functionalities/text-translation.html"
          target="_blank" rel="noreferrer">Como traduzir textos com o VLibras</a>
      </div>
    </section>
  );
}
