import { useId, useState } from "react";
import { CATALOG_PICTOGRAMS, searchPictograms, type Pictogram } from "../data/pictograms";
import { saveCatalogOverride, type PatientBoard } from "../lib/patientBoard";
import { ArasaacImage, ArasaacPicker } from "./ArasaacPicker";

export function BoardCatalogManager({ patientId, data, onChange }: { patientId: string; data: PatientBoard; onChange: () => void }) {
  const searchId = useId();
  const selectId = useId();
  const [query, setQuery] = useState("");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [id, setId] = useState("");
  const selected = CATALOG_PICTOGRAMS.find((item) => item.id === id);
  const overrides = new Map(data.overrides.map((item) => [item.symbol_id, item.arasaac_id]));
  const items = searchPictograms(CATALOG_PICTOGRAMS, query).filter((item) => !pendingOnly || (!item.arasaacId && !overrides.has(item.id)) || id === item.id);
  return <div className="space-y-4">
    <div className="space-y-1">
      <h3 className="font-semibold">Revisar pictogramas do catálogo</h3>
      <p className="text-sm text-stone-600">Escolha uma representação para uma palavra nesta prancha. A legenda, a fala e a origem da palavra são preservadas.</p>
    </div>
    <label htmlFor={searchId} className="block text-sm font-medium">Buscar palavra do catálogo</label>
    <input id={searchId} className="input-field" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
    <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={pendingOnly} className="size-4 accent-brand-600" onChange={(event) => setPendingOnly(event.target.checked)} /> Mostrar as palavras que aguardam seleção</label>
    <label htmlFor={selectId} className="block text-sm font-medium">Palavra a revisar</label>
    <select id={selectId} value={id} className="input-field" onChange={(event) => setId(event.target.value)}>
      <option value="">Selecione uma palavra</option>
      {selected && !items.some((item) => item.id === id) && <option value={id}>{selected.label}</option>}
      {items.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.category}</option>)}
    </select>
    {items.length === 0 && <p role="status" className="text-sm text-stone-600">Nenhuma palavra corresponde aos filtros.</p>}
    {selected && <CatalogSelection key={selected.id} patientId={patientId} item={selected} override={overrides.get(selected.id)} onChange={onChange} />}
  </div>;
}

function CatalogSelection({ patientId, item, override, onChange }: {
  patientId: string; item: Pictogram; override: number | undefined; onChange: () => void;
}) {
  const [selection, setSelection] = useState<number | null>(override ?? item.arasaacId ?? null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  async function save(useDefault: boolean) {
    if (pending || (!useDefault && !selection)) return;
    setPending(true);
    setFeedback(null);
    try {
      await saveCatalogOverride(patientId, item.id, useDefault ? null : selection);
      if (useDefault) setSelection(item.arasaacId ?? null);
      setFeedback({ message: useDefault ? "Representação original restaurada." : "Pictograma atualizado nesta prancha.", error: false });
      onChange();
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Não foi possível salvar o pictograma.", error: true });
    } finally { setPending(false); }
  }
  return <div className="space-y-3">
    <div className="flex items-center gap-3 rounded-xl border border-stone-200 p-3">
      {selection && <ArasaacImage id={selection} alt="" className="size-16 object-contain" />}
      <div>
        <p className="font-semibold">{item.label}</p>
        <p className="text-sm text-stone-600">{override ? "Seleção validada para este perfil" : item.arasaacId ? "Associação inicial verificada" : "Representação textual até a seleção de uma imagem"}</p>
      </div>
    </div>
    <ArasaacPicker initialTerm={item.label} disabled={pending} selectedId={selection} onSelect={setSelection} />
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${feedback.error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{feedback.message}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="button-primary" disabled={!selection || pending || selection === (override ?? item.arasaacId)} onClick={() => void save(false)}>Salvar pictograma</button>
      {override && <button type="button" className="button-secondary" disabled={pending} onClick={() => void save(true)}>Restaurar representação original</button>}
    </div>
  </div>;
}
