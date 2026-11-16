import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Star } from "lucide-react";
import { CATALOG_PICTOGRAMS, CATEGORY_OPTIONS, DEFAULT_HOME_SYMBOL_IDS, normalizeVocabularyText, searchPictograms, toCategoryId } from "../data/pictograms";
import { saveBoardSettings, type BoardSettings, type PatientBoard } from "../lib/patientBoard";

function ordered<T>(items: readonly T[], order: readonly string[], getId: (item: T) => string) {
  const idPosition = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (idPosition.get(getId(a)) ?? Infinity) - (idPosition.get(getId(b)) ?? Infinity));
}

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function moved(values: string[], index: number, delta: number) {
  const next = values.slice();
  const destination = index + delta;
  if (index >= 0 && destination >= 0 && destination < next.length) {
    [next[index], next[destination]] = [next[destination], next[index]];
  }
  return next;
}

function Setting({ title, children }: { title: string; children: ReactNode }) {
  return <label className="block space-y-1 text-sm font-medium"><span>{title}</span>{children}</label>;
}

function MoveButtons({ index, count, onMove, label }: { index: number; count: number; onMove: (delta: number) => void; label: string }) {
  return <div className="flex flex-wrap gap-2">
    <button type="button" className="button-secondary" aria-label={`Subir ${label}`} disabled={index <= 0} onClick={() => onMove(-1)}><ArrowUp size={16} aria-hidden="true" /> Subir</button>
    <button type="button" className="button-secondary" aria-label={`Descer ${label}`} disabled={index < 0 || index >= count - 1} onClick={() => onMove(1)}><ArrowDown size={16} aria-hidden="true" /> Descer</button>
  </div>;
}

export function BoardSettingsManager({ data, patientId, onChange }: { data: PatientBoard; patientId: string; onChange: () => void }) {
  const [draft, setDraft] = useState(data.settings);
  const [baseVersion, setBaseVersion] = useState(data.settingsVersion);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ failure: boolean; message: string } | null>(null);
  const [categoryId, setCategoryId] = useState(CATEGORY_OPTIONS[0]?.id ?? "");
  const [orderId, setOrderId] = useState("");
  const [query, setQuery] = useState("");
  const orderIdLabel = useId();
  const categorySelectId = useId();
  const activeCategories = draft.enabledCategories ?? CATEGORY_OPTIONS.map((item) => item.id);
  const categoryOrder = ordered(CATEGORY_OPTIONS, draft.categoryOrder, (category) => category.id);
  const currentCategory = categoryOrder.findIndex((category) => category.id === categoryId);
  const homeSymbols = draft.homeSymbols ?? DEFAULT_HOME_SYMBOL_IDS;
  const symbols = [
    ...CATALOG_PICTOGRAMS.filter((symbol) => (symbol.categories ?? [symbol.category]).some((category) => toCategoryId(category) === categoryId)),
    ...data.symbols.filter((symbol) => !symbol.hidden && symbol.categories.includes(categoryId)),
  ];
  const orderedSymbols = ordered(symbols, draft.symbolOrder[categoryId] ?? [], (symbol) => symbol.id);
  const orderIndex = orderedSymbols.findIndex((symbol) => symbol.id === orderId);
  const normalizedQuery = normalizeVocabularyText(query);
  const matches = normalizedQuery
    ? [...data.symbols.filter((symbol) => !symbol.hidden && normalizeVocabularyText(symbol.label).includes(normalizedQuery)), ...searchPictograms(CATALOG_PICTOGRAMS, query)]
    : [...data.symbols.filter((symbol) => !symbol.hidden), ...CATALOG_PICTOGRAMS.filter((item) => homeSymbols.includes(item.id) || draft.favorites.includes(item.id))];
  const visibleMatches = matches.slice(0, 24);
  const stale = data.settingsVersion > baseVersion;

  function set<K extends keyof BoardSettings>(key: K, value: BoardSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || stale) return;
    setFeedback(null);
    setPending(true);
    try {
      const saved = await saveBoardSettings(patientId, draft, baseVersion);
      setBaseVersion(saved.version);
      setFeedback({ failure: false, message: "Preferências da prancha salvas." });
      onChange();
    } catch (error) {
      setFeedback({ failure: true, message: error instanceof Error ? error.message : "Não foi possível salvar as preferências." });
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={(event) => void submit(event)} className="space-y-6">
    <fieldset disabled={pending} className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Setting title="Cartões por linha">
          <select className="input-field" value={draft.columns} onChange={(event) => set("columns", Number(event.target.value))}>
            {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} cartões</option>)}
          </select>
        </Setting>
        <Setting title="Cartões por página">
          <select className="input-field" value={draft.pageSize} onChange={(event) => set("pageSize", Number(event.target.value))}>
            {[4, 6, 8, 12, 18, 24, 30, 36].map((count) => <option key={count} value={count}>{count} cartões</option>)}
          </select>
        </Setting>
        <Setting title="Tamanho dos cartões">
          <select className="input-field" value={draft.cardSize} onChange={(event) => set("cardSize", event.target.value as BoardSettings["cardSize"])}>
            <option value="compact">Compacto</option><option value="regular">Padrão</option><option value="large">Grande</option>
          </select>
        </Setting>
        <Setting title="Tamanho dos pictogramas">
          <select className="input-field" value={draft.imageSize} onChange={(event) => set("imageSize", event.target.value as BoardSettings["imageSize"])}>
            <option value="small">Pequeno</option><option value="regular">Padrão</option><option value="large">Grande</option>
          </select>
        </Setting>
        <Setting title="Tamanho das legendas">
          <select className="input-field" value={draft.labelSize} onChange={(event) => set("labelSize", event.target.value as BoardSettings["labelSize"])}>
            <option value="regular">Padrão</option><option value="large">Grande</option><option value="extra">Extra grande</option>
          </select>
        </Setting>
        <Setting title="Espaçamento entre cartões">
          <select className="input-field" value={draft.spacing} onChange={(event) => set("spacing", event.target.value as BoardSettings["spacing"])}>
            <option value="compact">Compacto</option><option value="regular">Padrão</option><option value="loose">Amplo</option>
          </select>
        </Setting>
        <Setting title="Voz da prancha">
          <select className="input-field" value={draft.voiceURI} onChange={(event) => set("voiceURI", event.target.value)}>
            <option value="">Francisca · padrão</option><option value="pt-BR-AntonioNeural">Antônio</option>
          </select>
        </Setting>
        <Setting title={`Velocidade da voz: ${draft.rate.toLocaleString("pt-BR")}×`}>
          <input type="range" className="min-h-12 w-full accent-brand-600" min="0.5" max="1.5" step="0.1" value={draft.rate} onChange={(event) => set("rate", Number(event.target.value))} />
        </Setting>
        <label className="flex min-h-12 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={draft.contrast} onChange={(event) => set("contrast", event.target.checked)} className="size-5 accent-brand-600" /> Alto contraste</label>
      </div>

      <section className="space-y-3 border-t border-stone-200 pt-5" aria-label="Organizar categorias">
        <h3 className="font-semibold">Categorias</h3>
        <label htmlFor={categorySelectId} className="text-sm font-medium">Categoria a editar</label>
        <select id={categorySelectId} className="input-field" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setOrderId(""); }}>
          {categoryOrder.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
        {categoryId && <>
          <div className="flex flex-wrap gap-4">
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={activeCategories.includes(categoryId)} onChange={() => set("enabledCategories", toggle(activeCategories, categoryId))} /> Mostrar categoria</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={draft.favoriteCategories.includes(categoryId)} onChange={() => set("favoriteCategories", toggle(draft.favoriteCategories, categoryId))} /> Categoria favorita</label>
          </div>
          <MoveButtons index={currentCategory} count={categoryOrder.length} label="categoria" onMove={(change) => set("categoryOrder", moved(categoryOrder.map((category) => category.id), currentCategory, change))} />
          <label htmlFor={orderIdLabel} className="block text-sm font-medium">Ordem dos símbolos nesta categoria</label>
          <select id={orderIdLabel} className="input-field" value={orderId} onChange={(event) => setOrderId(event.target.value)}>
            <option value="">Selecione o símbolo para mover</option>
            {orderedSymbols.map((symbol, index) => <option key={symbol.id} value={symbol.id}>{index + 1}. {symbol.label}</option>)}
          </select>
          <MoveButtons index={orderIndex} count={orderedSymbols.length} label="símbolo" onMove={(change) => set("symbolOrder", {
            ...draft.symbolOrder, [categoryId]: moved(orderedSymbols.map((symbol) => symbol.id), orderIndex, change),
          })} />
        </>}
      </section>

      <section className="space-y-3 border-t border-stone-200 pt-5" aria-label="Organizar favoritos e início">
        <h3 className="flex items-center gap-2 font-semibold"><Star size={18} aria-hidden="true" /> Favoritos e Início</h3>
        <Setting title="Encontrar símbolo para organizar">
          <input type="search" className="input-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busque pelo texto do cartão" />
        </Setting>
        {visibleMatches.length ? <ul className="divide-y divide-stone-100">
          {visibleMatches.map((symbol) => <li key={symbol.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 py-1 text-sm">
            <span className="min-w-28 flex-1 font-medium">{symbol.label}</span>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-4 accent-brand-600" checked={draft.favorites.includes(symbol.id)} disabled={draft.favorites.length >= 256 && !draft.favorites.includes(symbol.id)} aria-label={`Marcar ${symbol.label} como favorito`} onChange={() => set("favorites", toggle(draft.favorites, symbol.id))} /> Favorito</label>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-4 accent-brand-600" checked={homeSymbols.includes(symbol.id)} disabled={homeSymbols.length >= 36 && !homeSymbols.includes(symbol.id)} aria-label={`Mostrar ${symbol.label} no Início`} onChange={() => set("homeSymbols", toggle(homeSymbols, symbol.id))} /> No Início</label>
          </li>)}
        </ul> : <p role="status" className="text-sm text-stone-600">Nenhum símbolo encontrado.</p>}
        {matches.length > visibleMatches.length && <p className="text-sm text-stone-600">Refine a busca para ver outros símbolos.</p>}
        {homeSymbols.length >= 36 && <p className="text-sm text-stone-600">O Início comporta até 36 símbolos.</p>}
        {draft.homeSymbols !== null && <button className="button-secondary" type="button" onClick={() => set("homeSymbols", null)}>Restaurar símbolos do Início</button>}
      </section>
    </fieldset>
    {feedback && <p role={feedback.failure ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${feedback.failure ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{feedback.message}</p>}
    {stale && <div className="space-y-2 rounded-xl bg-amber-50 p-3">
      <p role="alert" className="text-sm text-amber-950">As preferências mudaram em outra sessão. Carregue a versão atual antes de refazer suas alterações.</p>
      <button type="button" className="button-secondary" onClick={() => {
        setDraft(data.settings); setBaseVersion(data.settingsVersion); setFeedback(null);
      }}>Carregar versão atual</button>
    </div>}
    <button className="button-primary" type="submit" disabled={pending || stale}>{pending ? "Salvando…" : "Salvar preferências"}</button>
  </form>;
}
