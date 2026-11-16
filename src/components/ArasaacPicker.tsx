import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { getArasaacImageUrl, getArasaacPublicTerms, searchArasaac, type ArasaacResult } from "../lib/arasaac";

export function ArasaacImage({ id, alt, className, fallback }: {
  id: number; alt: string; className?: string; fallback?: ReactNode;
}) {
  const [failedId, setFailedId] = useState<number | null>(null);
  if (failedId === id) return fallback ?? <span className="text-sm text-stone-600">Imagem indisponível</span>;
  return <img src={getArasaacImageUrl(id)} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setFailedId(id)} />;
}

export function ArasaacPicker({ onSelect, selectedId, disabled, initialTerm }: {
  onSelect: (id: number) => void;
  selectedId: number | null;
  disabled: boolean;
  initialTerm?: string;
}) {
  const inputId = useId();
  const [search, setSearch] = useState(initialTerm ?? "");
  const [requested, setRequested] = useState<string | null>(null);
  const [results, setResults] = useState<ArasaacResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const suggestions = getArasaacPublicTerms(search).slice(0, 8);

  async function load(term: string) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setSearch(term);
    setRequested(term);
    setResults([]);
    setError(null);
    setPending(true);
    try {
      const rows = await searchArasaac(term, { signal: request.signal });
      if (!request.signal.aborted) setResults(rows);
    } catch {
      if (!request.signal.aborted) setError("Não foi possível consultar o ARASAAC. Confira a conexão e tente novamente.");
    } finally {
      if (!request.signal.aborted) setPending(false);
    }
  }

  return <section aria-label="Galeria de pictogramas ARASAAC" className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-4">
    <label htmlFor={inputId} className="text-sm font-semibold">Pesquisar pictograma do ARASAAC</label>
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute top-4 left-4 text-stone-500" aria-hidden="true" />
      <input id={inputId} type="search" className="input-field pl-10" placeholder="Digite uma palavra do vocabulário" value={search} maxLength={80} onKeyDown={(event) => {
        // Enter in this search must stay inside the gallery, even inside a symbol form.
        if (event.key !== "Enter") return;
        event.preventDefault();
        const exact = suggestions.find((term) => term.localeCompare(search.trim(), "pt-BR", { sensitivity: "base" }) === 0);
        if (exact) void load(exact);
      }} onChange={(event) => {
        controller.current?.abort();
        setSearch(event.target.value);
        setRequested(null);
        setPending(false);
        setResults([]);
        setError(null);
      }} disabled={disabled} />
    </div>
    <p className="text-sm text-stone-600">Selecione uma palavra pública para consultar o catálogo. As legendas e os nomes privados do paciente ficam no Comunica.</p>
    {suggestions.length > 0
      ? <div className="flex flex-wrap gap-2">{suggestions.map((term) =>
        <button type="button" className="rounded-full border border-brand-100 bg-white px-3 py-2 text-sm font-medium text-brand-700" key={term} disabled={disabled} onClick={() => void load(term)}>{term}</button>,
      )}</div>
      : <p className="text-sm text-stone-600" role="status">Nenhuma palavra pública encontrada. Experimente um termo geral.</p>}
    {pending && <p role="status" className="text-sm text-stone-600">Consultando pictogramas…</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {requested && !pending && !error && results.length === 0 && <p role="status" className="text-sm text-stone-600">Nenhum pictograma encontrado para {requested}.</p>}
    {results.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {results.map((item) => {
        const description = item.labels.join(", ") || requested || "Pictograma";
        return <button type="button" key={item.id} aria-label={`${description}, pictograma ${item.id}`} aria-pressed={selectedId === item.id} disabled={disabled}
          className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border bg-white p-2 text-sm font-medium ${selectedId === item.id ? "border-brand-600 ring-2 ring-brand-100" : "border-stone-200"}`}
          onClick={() => onSelect(item.id)}>
          <ArasaacImage id={item.id} alt="" className="size-16 object-contain" />
          <span>{description}</span>
        </button>;
      })}
    </div>}
  </section>;
}
