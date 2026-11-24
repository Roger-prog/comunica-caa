import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Volume2 } from "lucide-react";
import {
  DEFAULT_HOME_SYMBOL_IDS,
  getBoardCategoryOptions,
  searchPictograms,
  toCategoryId,
  type Pictogram,
} from "../data/pictograms";
import { useSpeech } from "../hooks/useSpeech";
import { applyPatientBoard } from "../lib/boardPresentation";
import { saveBoardSettings } from "../lib/patientBoard";
import { DEFAULT_LOCAL_NEURAL_VOICE, LOCAL_NEURAL_VOICES } from "../lib/localNeuralVoices";
import { SpeechFeedback } from "./SpeechFeedback";
import { LOCAL_SPEECH_VOICE } from "../lib/speechEngine";
import {
  MAX_QUICK_PHRASES,
  MAX_SENTENCE_SYMBOLS,
  MIN_SENTENCE_SYMBOLS,
  type BoardQuickPhrase,
  type BoardSettings,
  type PatientBoard,
} from "../lib/patientBoardModel";
import { PictogramPicture } from "./PictogramPicture";
import { ArasaacPicker } from "./ArasaacPicker";
import { CategoryPicture } from "./CategoryPicture";

const sections = [
  { id: "appearance", label: "Aparência" },
  { id: "voice", label: "Voz" },
  { id: "organization", label: "Organização" },
  { id: "home", label: "Favoritos e Início" },
] as const;

type Section = (typeof sections)[number]["id"];
type ChangeSetting = <K extends keyof BoardSettings>(key: K, value: BoardSettings[K]) => void;

function ordered<T>(items: readonly T[], order: readonly string[], getId: (item: T) => string) {
  const position = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) =>
    (position.get(getId(a)) ?? items.length + order.length) -
    (position.get(getId(b)) ?? items.length + order.length),
  );
}

function toggle(values: readonly string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function moved<T>(values: readonly T[], index: number, delta: number) {
  const next = [...values];
  const destination = index + delta;
  if (index >= 0 && index < next.length && destination >= 0 && destination < next.length) {
    [next[index], next[destination]] = [next[destination], next[index]];
  }
  return next;
}

function Setting({ title, children }: { title: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1 text-sm font-medium"><span>{title}</span>{children}</label>;
}

function MoveButtons({ index, count, onMove, label }: {
  index: number;
  count: number;
  onMove: (delta: number) => void;
  label: string;
}) {
  return <div className="flex flex-wrap gap-2">
    <button type="button" className="button-secondary" aria-label={"Subir " + label}
      disabled={index <= 0} onClick={() => onMove(-1)}>
      <ArrowUp size={16} aria-hidden="true" /> Subir
    </button>
    <button type="button" className="button-secondary" aria-label={"Descer " + label}
      disabled={index < 0 || index >= count - 1} onClick={() => onMove(1)}>
      <ArrowDown size={16} aria-hidden="true" /> Descer
    </button>
  </div>;
}

function AppearanceSettings({ draft, set }: { draft: BoardSettings; set: ChangeSetting }) {
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
    <Setting title="Cartões por linha">
      <select className="input-field" value={draft.columns} onChange={(event) => set("columns", Number(event.target.value))}>
        {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} cartões</option>)}
      </select>
    </Setting>
    <Setting title="Cartões por página">
      <select className="input-field" value={draft.pageSize} onChange={(event) => set("pageSize", Number(event.target.value))}>
        {Array.from({ length: 33 }, (_, index) => index + 4).map((count) =>
          <option key={count} value={count}>{count} cartões</option>,
        )}
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
    <label className="flex min-h-12 items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={draft.contrast} onChange={(event) => set("contrast", event.target.checked)} className="size-5 accent-brand-600" />
      Alto contraste
    </label>
  </div>;
}

function VoiceSettings({ draft, set }: { draft: BoardSettings; set: ChangeSetting }) {
  const speech = useSpeech(undefined, `${draft.voiceURI}/${draft.rate}`);

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <Setting title="Voz da prancha">
        <select className="input-field" value={draft.voiceURI || DEFAULT_LOCAL_NEURAL_VOICE} onChange={(event) => set("voiceURI", event.target.value)}>
          <optgroup label="Vozes neurais no dispositivo">
            {LOCAL_NEURAL_VOICES.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}
          </optgroup>
          <optgroup label="Gravações para vocabulário incluído">
            <option value="pt-BR-FranciscaNeural">Francisca</option>
            <option value="pt-BR-AntonioNeural">Antônio</option>
          </optgroup>
          <option value={LOCAL_SPEECH_VOICE}>Voz local do dispositivo (pt-BR)</option>
        </select>
      </Setting>
      <Setting title={"Velocidade da voz: " + draft.rate.toLocaleString("pt-BR") + "×"}>
        <input type="range" className="min-h-12 w-full accent-brand-600" min="0.5" max="1.5" step="0.1"
          value={draft.rate} onChange={(event) => set("rate", Number(event.target.value))} />
      </Setting>
    </div>
    <p className="text-sm text-stone-600">
      Faber e Edresson leem símbolos e frases neste dispositivo. O primeiro uso pode levar mais tempo para carregar a voz.
      Francisca e Antônio estão disponíveis para as gravações incluídas.
    </p>
    <button type="button" className="button-secondary" disabled={!speech.supported} onClick={() => {
      if (speech.speaking) speech.stop();
      else speech.speak("Olá", { voiceURI: draft.voiceURI, rate: draft.rate, offlineOnly: true });
    }}>
      <Volume2 size={18} aria-hidden="true" /> {speech.speaking ? "Parar prévia da voz" : "Ouvir prévia da voz"}
    </button>
    <SpeechFeedback speech={speech} />
    <label className="flex min-h-12 items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={draft.speakOnSelect} onChange={(event) => set("speakOnSelect", event.target.checked)} className="size-5 accent-brand-600" />
      Ouvir o símbolo ao adicioná-lo à frase
    </label>
    <Setting title="Limite de símbolos por frase">
      <select className="input-field max-w-64" value={draft.maxSentenceSymbols} onChange={(event) => set("maxSentenceSymbols", Number(event.target.value))}>
        {Array.from({ length: MAX_SENTENCE_SYMBOLS - MIN_SENTENCE_SYMBOLS + 1 }, (_, index) => index + MIN_SENTENCE_SYMBOLS)
          .map((count) => <option key={count} value={count}>{count} símbolos</option>)}
      </select>
    </Setting>
  </div>;
}

function QuickPhrasesSettings({ draft, set, invalidPhraseId }: {
  draft: BoardSettings;
  set: ChangeSetting;
  invalidPhraseId: string | null;
}) {
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const labelInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const phrase = draft.quickPhrases.find((item) => item.id === selectedId)
    ?? draft.quickPhrases.find((item) => item.id === invalidPhraseId)
    ?? draft.quickPhrases[0];
  const index = phrase ? draft.quickPhrases.findIndex((item) => item.id === phrase.id) : -1;

  useEffect(() => {
    if (!invalidPhraseId) return;
    setOpen(true);
    setSelectedId(invalidPhraseId);
  }, [invalidPhraseId]);

  useEffect(() => {
    if (!open || !invalidPhraseId || phrase?.id !== invalidPhraseId) return;
    if (!phrase.label.trim()) labelInput.current?.focus();
    else textInput.current?.focus();
  }, [open, invalidPhraseId, phrase]);

  function editPhrase(changes: Partial<Pick<BoardQuickPhrase, "label" | "text">>) {
    if (phrase) set("quickPhrases", draft.quickPhrases.map((item) => item.id === phrase.id ? { ...item, ...changes } : item));
  }

  function addPhrase() {
    const id = crypto.randomUUID();
    set("quickPhrases", [...draft.quickPhrases, { id, label: "", text: "" }]);
    setSelectedId(id);
  }

  return <div className="space-y-3 border-t border-stone-200 pt-4">
    <button type="button" className="button-secondary" aria-expanded={open} aria-controls={regionId}
      onClick={() => setOpen((current) => !current)}>Frases rápidas</button>
    <div id={regionId} hidden={!open} className="space-y-3">
      {open && <>
        <label className="flex min-h-12 items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={draft.quickPhrasesEnabled} onChange={(event) => set("quickPhrasesEnabled", event.target.checked)} className="size-5 accent-brand-600" />
          Mostrar frases rápidas na prancha
        </label>
        <button type="button" className="button-secondary" disabled={draft.quickPhrases.length >= MAX_QUICK_PHRASES}
          onClick={addPhrase}>Adicionar frase rápida</button>
        {phrase ? <>
          <Setting title="Frase rápida a editar">
            <select className="input-field" value={phrase.id} onChange={(event) => setSelectedId(event.target.value)}>
              {draft.quickPhrases.map((item, position) =>
                <option key={item.id} value={item.id}>{position + 1}. {item.label.trim() || "Nova frase"}</option>,
              )}
            </select>
          </Setting>
          <div className="grid gap-3 sm:grid-cols-2">
            <Setting title="Rótulo da frase rápida">
              <input ref={labelInput} className="input-field" value={phrase.label} maxLength={80} onChange={(event) => editPhrase({ label: event.target.value })} />
            </Setting>
            <Setting title="Texto falado da frase rápida">
              <textarea ref={textInput} className="input-field min-h-20" value={phrase.text} maxLength={150} onChange={(event) => editPhrase({ text: event.target.value })} />
            </Setting>
          </div>
          <div className="flex flex-wrap gap-2">
            <MoveButtons index={index} count={draft.quickPhrases.length} label="frase rápida"
              onMove={(delta) => set("quickPhrases", moved(draft.quickPhrases, index, delta))} />
            <button type="button" className="button-secondary"
              onClick={() => set("quickPhrases", draft.quickPhrases.filter((item) => item.id !== phrase.id))}>
              Remover frase rápida
            </button>
          </div>
        </> : <p role="status" className="text-sm text-stone-600">Nenhuma frase rápida cadastrada.</p>}
      </>}
    </div>
  </div>;
}

function OrganizationSettings({ draft, set, catalog, hiddenCount, onShowHiddenSymbols, invalidPhraseId }: {
  draft: BoardSettings;
  set: ChangeSetting;
  catalog: readonly Pictogram[];
  hiddenCount: number;
  onShowHiddenSymbols?: () => void;
  invalidPhraseId: string | null;
}) {
  const categories = useMemo(() => getBoardCategoryOptions(catalog), [catalog]);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [orderId, setOrderId] = useState("");
  const activeCategories = draft.enabledCategories ?? categories.map((item) => item.id);
  const categoryOrder = ordered(categories, [...new Set([...draft.categoryOrder, ...draft.favoriteCategories])], (category) => category.id);
  const currentCategory = categoryOrder.findIndex((category) => category.id === categoryId);
  const symbols = catalog.filter((symbol) => (symbol.categories ?? [symbol.category]).some((category) => toCategoryId(category) === categoryId));
  const orderedSymbols = ordered(symbols, draft.symbolOrder[categoryId] ?? [], (symbol) => symbol.id);
  const orderIndex = orderedSymbols.findIndex((symbol) => symbol.id === orderId);
  const categoryImage = draft.categoryImages[categoryId];

  function restoreCategoryImage() {
    const images = { ...draft.categoryImages };
    delete images[categoryId];
    set("categoryImages", images);
  }

  return <div className="space-y-4">
    <Setting title="Categoria a editar">
      <select className="input-field" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setOrderId(""); }}>
        {categoryOrder.map(({ id, label }, index) => <option key={id} value={id}>{index + 1}. {label}</option>)}
      </select>
    </Setting>
    {categoryId && <>
      <div className="flex flex-wrap gap-x-4">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-brand-600" checked={activeCategories.includes(categoryId)}
            onChange={() => set("enabledCategories", toggle(activeCategories, categoryId))} /> Mostrar categoria
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-brand-600" checked={draft.favoriteCategories.includes(categoryId)}
            onChange={() => set("favoriteCategories", toggle(draft.favoriteCategories, categoryId))} /> Categoria favorita
        </label>
      </div>
      <MoveButtons index={currentCategory} count={categoryOrder.length} label="categoria"
        onMove={(change) => set("categoryOrder", moved(categoryOrder.map((category) => category.id), currentCategory, change))} />
      <details key={categoryId} className="rounded-2xl border border-stone-200 p-3">
        <summary className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
          <CategoryPicture categoryId={categoryId} override={categoryImage} /> Imagem da categoria
        </summary>
        <div className="mt-3 space-y-3">
          {categoryImage && <button type="button" className="button-secondary" onClick={restoreCategoryImage}>
            Restaurar imagem padrão
          </button>}
          <ArasaacPicker disabled={false} selectedId={categoryImage ?? null}
            onSelect={(id) => set("categoryImages", { ...draft.categoryImages, [categoryId]: id })} />
        </div>
      </details>
      <Setting title="Ordem dos símbolos nesta categoria">
        <select className="input-field" value={orderId} onChange={(event) => setOrderId(event.target.value)}>
          <option value="">Selecione o símbolo para mover</option>
          {orderedSymbols.map((symbol, index) => <option key={symbol.id} value={symbol.id}>{index + 1}. {symbol.label}</option>)}
        </select>
      </Setting>
      <MoveButtons index={orderIndex} count={orderedSymbols.length} label="símbolo na categoria" onMove={(change) => set("symbolOrder", {
        ...draft.symbolOrder, [categoryId]: moved(orderedSymbols.map((symbol) => symbol.id), orderIndex, change),
      })} />
    </>}
    {onShowHiddenSymbols && <div className="border-t border-stone-200 pt-4">
      <button type="button" className="button-secondary" onClick={onShowHiddenSymbols}>Símbolos ocultos ({hiddenCount})</button>
    </div>}
    <QuickPhrasesSettings draft={draft} set={set} invalidPhraseId={invalidPhraseId} />
  </div>;
}

const previewHeight = { compact: "min-h-16", regular: "min-h-20", large: "min-h-24" } as const;
const previewFont = { regular: "text-sm", large: "text-base", extra: "text-lg" } as const;

function HomeSettings({ draft, set, catalog }: {
  draft: BoardSettings;
  set: ChangeSetting;
  catalog: readonly Pictogram[];
}) {
  const [query, setQuery] = useState("");
  const [homeOrderId, setHomeOrderId] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const confirmationHeading = useId();
  const homeIds = draft.homeSymbols ?? DEFAULT_HOME_SYMBOL_IDS;
  const catalogById = useMemo(() => new Map(catalog.map((symbol) => [symbol.id, symbol])), [catalog]);
  const home = homeIds.flatMap((id) => {
    const symbol = catalogById.get(id);
    return symbol ? [symbol] : [];
  });
  const homeOrderIndex = home.findIndex((symbol) => symbol.id === homeOrderId);
  const matches = query.trim()
    ? searchPictograms(catalog, query.trim())
    : catalog.filter((item) => item.source === "custom" || homeIds.includes(item.id) || draft.favorites.includes(item.id));
  const visibleMatches = matches.slice(0, 12);
  const gridStyle = {
    "--board-cols": draft.columns,
    "--board-mobile-cols": Math.min(draft.columns, 3),
    "--board-gap": { compact: "0.5rem", regular: "0.75rem", loose: "1.25rem" }[draft.spacing],
  } as CSSProperties;

  useEffect(() => {
    if (confirmReset) cancelReset.current?.focus();
  }, [confirmReset]);

  function closeReset(apply: boolean) {
    setConfirmReset(false);
    if (apply) {
      set("homeSymbols", null);
      setHomeOrderId("");
      previewHeading.current?.focus();
    } else resetButton.current?.focus();
  }

  function moveHome(delta: number) {
    const current = home[homeOrderIndex]?.id;
    const target = home[homeOrderIndex + delta]?.id;
    if (!current || !target) return;
    const index = homeIds.indexOf(current);
    const destination = homeIds.indexOf(target);
    set("homeSymbols", moved(homeIds, index, destination - index));
  }

  return <div className="space-y-4">
    <Setting title="Mover símbolo do Início">
      <select className="input-field" value={homeOrderIndex < 0 ? "" : homeOrderId} onChange={(event) => setHomeOrderId(event.target.value)}>
        <option value="">Selecione o símbolo para mover</option>
        {home.map((symbol, index) => <option key={symbol.id} value={symbol.id}>{index + 1}. {symbol.label}</option>)}
      </select>
    </Setting>
    <MoveButtons index={homeOrderIndex} count={home.length} label="símbolo no Início" onMove={moveHome} />
    <section aria-label="Prévia do Início" className="space-y-3 rounded-2xl border border-brand-100 bg-brand-50 p-3">
      <h4 ref={previewHeading} tabIndex={-1} className="font-semibold">Prévia do Início</h4>
      {home.length ? <ol style={gridStyle} className="board-card-grid max-h-72 overflow-auto" tabIndex={0} aria-label="Ordem dos cartões no Início">
        {home.map((symbol) => <li key={symbol.id} className={["flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl border bg-white p-2 text-center [overflow-wrap:anywhere]", draft.contrast ? "border-stone-950 text-stone-950" : "border-brand-100 text-ink", previewHeight[draft.cardSize], previewFont[draft.labelSize]].join(" ")}>
          <PictogramPicture item={symbol} size={draft.imageSize} />
          <span className="min-w-0 max-w-full">{symbol.label}</span>
        </li>)}
      </ol> : <p className="text-sm text-stone-600">Nenhum cartão no Início.</p>}
    </section>
    <button type="button" ref={resetButton} className="button-secondary" disabled={draft.homeSymbols === null}
      aria-expanded={confirmReset} onClick={() => setConfirmReset(true)}>Restaurar Início padrão</button>
    {confirmReset && <div role="group" aria-labelledby={confirmationHeading} className="rounded-2xl border border-amber-200 bg-amber-50 p-3"
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeReset(false); } }}>
      <p id={confirmationHeading} className="text-sm font-medium text-amber-950">
        Restaurar os cartões e a ordem padrão do Início?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" ref={cancelReset} className="button-secondary" onClick={() => closeReset(false)}>Cancelar</button>
        <button type="button" className="button-primary" onClick={() => closeReset(true)}>Confirmar restauração</button>
      </div>
    </div>}
    <div className="space-y-3 border-t border-stone-200 pt-4">
      <Setting title="Encontrar símbolo para organizar">
        <input type="search" className="input-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busque pelo texto do cartão"
          onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
      </Setting>
      {visibleMatches.length ? <ul className="divide-y divide-stone-100">
        {visibleMatches.map((symbol) => <li key={symbol.id} className="flex flex-wrap items-center gap-x-5 py-1 text-sm">
          <span className="min-w-24 flex-1 [overflow-wrap:anywhere] font-medium">{symbol.label}</span>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="size-5 accent-brand-600" checked={draft.favorites.includes(symbol.id)}
              disabled={draft.favorites.length >= 256 && !draft.favorites.includes(symbol.id)}
              aria-label={"Marcar " + symbol.label + " como favorito"} onChange={() => set("favorites", toggle(draft.favorites, symbol.id))} />
            Favorito
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="size-5 accent-brand-600" checked={homeIds.includes(symbol.id)}
              disabled={homeIds.length >= 36 && !homeIds.includes(symbol.id)}
              aria-label={"Mostrar " + symbol.label + " no Início"} onChange={() => set("homeSymbols", toggle(homeIds, symbol.id))} />
            No Início
          </label>
        </li>)}
      </ul> : <p role="status" className="text-sm text-stone-600">Nenhum símbolo encontrado.</p>}
      {matches.length > visibleMatches.length && <p className="text-sm text-stone-600">Refine a busca para ver outros símbolos.</p>}
    </div>
  </div>;
}

export function BoardSettingsManager({ data, patientId, onChange, onShowHiddenSymbols, active: visible = true }: {
  data: PatientBoard;
  patientId: string;
  onChange: () => void;
  onShowHiddenSymbols?: () => void;
  active?: boolean;
}) {
  const [draft, setDraft] = useState(data.settings);
  const [baseVersion, setBaseVersion] = useState(data.settingsVersion);
  const [active, setActive] = useState<Section>("appearance");
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const inFlight = useRef(false);
  const [feedback, setFeedback] = useState<{ failure: boolean; message: string } | null>(null);
  const [invalidPhraseId, setInvalidPhraseId] = useState<string | null>(null);
  const activeHeading = useId();
  const panelId = useId();
  const catalog = useMemo(() => applyPatientBoard(data), [data]);
  const stale = data.settingsVersion > baseVersion;

  useEffect(() => {
    if (!stale || dirty || pending) return;
    setDraft(data.settings);
    setBaseVersion(data.settingsVersion);
  }, [stale, dirty, pending, data.settings, data.settingsVersion]);

  function set<K extends keyof BoardSettings>(key: K, value: BoardSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setFeedback(null);
    if (key === "quickPhrases") setInvalidPhraseId(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || stale) return;
    setFeedback(null);
    const invalidPhrase = draft.quickPhrases.find((phrase) => !phrase.label.trim() || !phrase.text.trim());
    if (invalidPhrase) {
      setActive("organization");
      setInvalidPhraseId(invalidPhrase.id);
      setFeedback({ failure: true, message: "Preencha o rótulo e o texto falado da frase rápida." });
      return;
    }

    inFlight.current = true;
    setPending(true);
    try {
      const saved = await saveBoardSettings(patientId, draft, baseVersion);
      setBaseVersion(saved.version);
      if (saved.settings) setDraft(saved.settings);
      setDirty(false);
      setFeedback({ failure: false, message: "Preferências da prancha salvas." });
      onChange();
    } catch (error) {
      setFeedback({ failure: true, message: error instanceof Error ? error.message : "Não foi possível salvar as preferências." });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <form onSubmit={(event) => void submit(event)} className="min-w-0 space-y-4">
    <div role="group" aria-label="Seções das preferências" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {sections.map(({ id, label }) => <button type="button" key={id} aria-pressed={active === id} aria-controls={panelId}
        className={active === id ? "button-primary px-3" : "button-secondary px-3"} onClick={() => setActive(id)}>{label}</button>)}
    </div>
    <fieldset disabled={pending} aria-busy={pending} className="min-w-0">
      <section id={panelId} aria-labelledby={activeHeading} className="space-y-3">
        <h3 id={activeHeading} className="font-semibold">{sections.find(({ id }) => id === active)?.label}</h3>
        {active === "appearance" && <AppearanceSettings draft={draft} set={set} />}
        {active === "voice" && visible && <VoiceSettings draft={draft} set={set} />}
        {active === "organization" && <OrganizationSettings draft={draft} set={set} catalog={catalog}
          hiddenCount={data.symbols.filter((symbol) => symbol.hidden).length} onShowHiddenSymbols={onShowHiddenSymbols} invalidPhraseId={invalidPhraseId} />}
        {active === "home" && <HomeSettings draft={draft} set={set} catalog={catalog} />}
      </section>
    </fieldset>
    {feedback && <p role={feedback.failure ? "alert" : "status"}
      className={feedback.failure ? "rounded-xl bg-red-50 p-3 text-sm text-red-800" : "rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"}>
      {feedback.message}
    </p>}
    {stale && <div className="space-y-2 rounded-xl bg-amber-50 p-3">
      <p role="alert" className="text-sm text-amber-950">As preferências mudaram em outra sessão. Carregue a versão atual antes de refazer suas alterações.</p>
      <button type="button" className="button-secondary" onClick={() => {
        setDraft(data.settings);
        setBaseVersion(data.settingsVersion);
        setDirty(false);
        setInvalidPhraseId(null);
        setFeedback(null);
      }}>Carregar versão atual</button>
    </div>}
    <button className="button-primary" type="submit" disabled={pending || stale}>{pending ? "Salvando…" : "Salvar preferências"}</button>
  </form>;
}
