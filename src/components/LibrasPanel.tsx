import { useState } from "react";

export function LibrasPanel({ phrase }: { phrase: string }) {
  const [open, setOpen] = useState(false);
  const escaped = phrase.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return <details className="mt-2" onToggle={event => { if (!event.currentTarget.open) setOpen(false); }}>
    <summary className="inline-flex min-h-12 cursor-pointer items-center underline">Traduzir em Libras</summary>
    <p className="text-sm">O VLibras recebe a frase escolhida para fazer a tradução. Abra o intérprete e selecione o texto.</p>
    {open ? <><iframe sandbox="allow-scripts" referrerPolicy="no-referrer" title="Intérprete VLibras"
      className="my-2 h-96 w-full rounded-2xl border-2" srcDoc={'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><p style="font:20px system-ui">' + escaped + '</p><script src="https://vlibras.gov.br/app/vlibras-plugin.js"></script></html>'} />
      <button className="board-control" onClick={() => setOpen(false)}>Fechar intérprete</button></> :
      <button className="board-control" onClick={() => setOpen(true)}>Abrir intérprete para esta frase</button>}
  </details>;
}
