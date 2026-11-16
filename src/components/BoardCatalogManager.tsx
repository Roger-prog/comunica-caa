import { useId, useMemo, useRef, useState } from "react";
import { CATALOG_PICTOGRAMS, getPictogramSpeech, searchPictograms, type Pictogram } from "../data/pictograms";
import { saveCatalogOverride, type PatientBoard } from "../lib/patientBoard";
import { ArasaacImage, ArasaacPicker } from "./ArasaacPicker";

type CatalogFilter = "all" | "associated" | "pending";

function imageStatus(item: Pictogram, override: number | undefined) {
  if (override) return "Personalizado neste perfil";
  return item.arasaacId ? "Pictograma do catálogo geral" : "Aguardando revisão";
}

export function BoardCatalogManager({ patientId, patientName, data, onChange }: {
  patientId: string;
  patientName: string;
  data: PatientBoard;
  onChange: () => void;
}) {
  const searchId = useId();
  const filterId = useId();
  const selectId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [id, setId] = useState("");
  const selected = CATALOG_PICTOGRAMS.find((item) => item.id === id);
  const overrides = useMemo(() => new Map(
    data.overrides.map((item) => [item.symbol_id, item.arasaac_id]),
  ), [data.overrides]);
  const results = useMemo(() => searchPictograms(CATALOG_PICTOGRAMS, query), [query]);
  const items = results.filter((item) => {
    if (filter === "all") return true;
    const hasImage = Boolean(item.arasaacId || overrides.has(item.id));
    return filter === "associated" ? hasImage : !hasImage;
  });
  function itemOption(item: Pictogram) {
    return <option key={item.id} value={item.id}>{item.label} · {item.category} · {imageStatus(item, overrides.get(item.id))}</option>;
  }

  return <div className="space-y-4">
    <p className="text-sm text-stone-600">Escolha a imagem para a prancha de <strong>{patientName}</strong>. A palavra, a fala e a categoria continuam as mesmas.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label htmlFor={searchId} className="space-y-1 text-sm font-medium">
        <span>Buscar palavra do catálogo</span>
        <input id={searchId} className="input-field" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label htmlFor={filterId} className="space-y-1 text-sm font-medium">
        <span>Situação do pictograma</span>
        <select id={filterId} className="input-field" value={filter} onChange={(event) => {
          setFilter(event.target.value as CatalogFilter);
        }}>
          <option value="all">Todas as palavras</option>
          <option value="associated">Com pictograma</option>
          <option value="pending">Aguardando revisão</option>
        </select>
      </label>
    </div>
    <label htmlFor={selectId} className="block text-sm font-medium">Palavra a revisar</label>
    <select id={selectId} value={id} className="input-field" onChange={(event) => setId(event.target.value)}>
      <option value="">Selecione uma palavra</option>
      {selected && !items.some((item) => item.id === id) && itemOption(selected)}
      {items.map(itemOption)}
    </select>
    {items.length === 0 && <p role="status" className="text-sm text-stone-600">Nenhuma palavra corresponde aos filtros.</p>}
    {selected && <CatalogSelection key={selected.id} patientId={patientId} item={selected} override={overrides.get(selected.id)} onChange={onChange} />}
  </div>;
}

function ImagePreview({ title, id, item, description }: {
  title: string;
  id: number | undefined;
  item: Pictogram;
  description: string;
}) {
  return <div role="group" aria-label={title} className="flex min-w-0 items-center gap-3 rounded-xl border border-stone-200 p-3">
    {id && <ArasaacImage id={id} alt={`${title} para ${item.label}`} className="h-14 w-14 flex-none object-contain" />}
    <div className="min-w-0 break-words">
      <p className="text-xs font-medium text-stone-600">{title}</p>
      <p className="font-semibold">{item.label}</p>
      <p className="text-sm text-stone-600">{description}</p>
    </div>
  </div>;
}

function CatalogSelection({ patientId, item, override, onChange }: {
  patientId: string;
  item: Pictogram;
  override?: number;
  onChange: () => void;
}) {
  const [selection, setSelection] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const savingRequest = useRef(false);
  const currentId = override ?? item.arasaacId;
  const hasReplacement = Boolean(selection && selection !== currentId);

  async function save(useDefault: boolean) {
    if (savingRequest.current || (!useDefault && !hasReplacement)) return;
    const nextOverride = useDefault ? undefined : selection;
    savingRequest.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      await saveCatalogOverride(patientId, item.id, nextOverride ?? null);
      setSelection(undefined);
      setFeedback({ message: useDefault ? "Representação original restaurada." : "Pictograma atualizado nesta prancha.", error: false });
      onChange();
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Não foi possível salvar o pictograma.", error: true });
    } finally {
      setSaving(false);
      savingRequest.current = false;
    }
  }

  return <div className="space-y-3">
    <div className="grid gap-2 sm:grid-cols-2">
      <ImagePreview title="Imagem atual" item={item} id={currentId} description={imageStatus(item, override)} />
      {hasReplacement && <ImagePreview title="Prévia da nova imagem" item={item} id={selection} description="Aplicada ao salvar neste perfil" />}
    </div>
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-stone-600">
      <div className="flex flex-wrap gap-x-1"><dt className="font-semibold">Fala</dt><dd>{getPictogramSpeech(item)}</dd></div>
      <div className="flex flex-wrap gap-x-1"><dt className="font-semibold">Categoria</dt><dd>{item.category}</dd></div>
    </dl>
    <ArasaacPicker initialTerm={item.label} disabled={saving} selectedId={selection ?? currentId ?? null} onSelect={(id) => {
      setSelection(id);
      setFeedback(null);
    }} />
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${feedback.error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{feedback.message}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="button-primary" disabled={!hasReplacement || saving} onClick={() => void save(false)}>{saving ? "Salvando…" : "Salvar nesta prancha"}</button>
      {override && <button type="button" className="button-secondary" disabled={saving} onClick={() => void save(true)}>Restaurar representação original</button>}
    </div>
  </div>;
}
