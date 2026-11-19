import { useState } from "react";

const words = [
  ["Eu", "pessoas", "👤"], ["quero", "acoes", "☝️"], ["água", "coisas", "💧"],
  ["gelada", "adjetivos", "🧊"], ["por favor", "social", "🤲"],
] as const;

export function DemoBoard() {
  const [phrase, setPhrase] = useState<string[]>([]);
  return <section className="demo-board" aria-label="Experimente a prancha">
    <h2 className="text-2xl">Monte uma frase</h2>
    <p className="my-3" aria-live="polite">{phrase.join(" ") || "Escolha as palavras na ordem que quiser."}</p>
    <div className="flex flex-wrap gap-2">
      {words.map(([word, group, icon]) => <button type="button" key={word} disabled={phrase.length >= 20}
        className="demo-word" style={{ backgroundColor: "var(--color-" + group + ")" }}
        onClick={() => setPhrase([...phrase, word])}><span aria-hidden="true">{icon}</span>{word}</button>)}
    </div>
    <button className="button-secondary mt-4" type="button" disabled={!phrase.length} onClick={() => setPhrase([])}>Limpar exemplo</button>
  </section>;
}
