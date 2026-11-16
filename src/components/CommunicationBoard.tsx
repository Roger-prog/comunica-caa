import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, ImageOff, LockKeyhole, Plus, Search, Square, Star, Undo2, Volume2, X } from "lucide-react";
import {
  CATALOG_CATEGORIES,
  CATALOG_PICTOGRAMS,
  DEFAULT_HOME_SYMBOL_IDS,
  ESSENTIAL_PICTOGRAM_IDS,
  HEALTH_CATEGORIES,
  NEEDS_PICTOGRAM_IDS,
  getPictogramSpeech,
  searchPictograms,
  toCategoryId,
  type Pictogram,
} from "../data/pictograms";
import { hasBundledSpeech } from "../data/bundledSpeech";
import type { useSpeech } from "../hooks/useSpeech";
import { DEFAULT_BOARD_SETTINGS, type BoardQuickPhrase, type BoardSettings } from "../lib/patientBoardModel";
import { PatientPhoto } from "./PatientPhoto";

interface CommunicationBoardProps {
  onSelect: (pictogram: Pictogram) => void;
  speech: ReturnType<typeof useSpeech>;
  voiceURI: string;
  rate: number;
  largeCards: boolean;
  isChildMode?: boolean;
  onUnlockRequest?: () => void;
  onStartCommunication?: () => void;
  modePending?: boolean;
  catalog?: readonly Pictogram[];
  settings?: BoardSettings;
}

const VIEWS = [
  ["home", "Início"], ["essential", "Vocabulário essencial", "Essencial"], ["needs", "Necessidades"],
  ["categories", "Categorias"], ["health", "Saúde"], ["favorites", "Favoritos"],
  ["custom", "Meus símbolos"], ["quick", "Frases rápidas"],
] as const;
type View = typeof VIEWS[number][0];

function categoryMatch(item: Pictogram, category: string) {
  return item.category === category || item.categories?.includes(category);
}

function orderedByIds(items: readonly Pictogram[], ids: readonly string[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export function PictogramPicture({
  item, size = "regular", compact = false,
}: { item: Pictogram; size?: BoardSettings["imageSize"]; compact?: boolean }) {
  const [failedUrl, setFailedUrl] = useState("");
  const fallback = <ImageOff size={20} className="text-stone-500" />;
  const pictureSize = compact ? "size-8" : {
    small: "size-12", regular: "size-16 sm:size-20", large: "size-20 sm:size-24",
  }[size];
  if (!item.imagePath && !item.imageUrl && !item.symbol) return null;
  return (
    <span
      aria-hidden="true"
      className={pictureSize + " flex max-w-full shrink-0 items-center justify-center overflow-hidden rounded-xl text-3xl"}
      style={{ backgroundColor: item.color }}
    >
      {item.imagePath ? (
        <PatientPhoto path={item.imagePath} alt="" className="size-full object-contain" fallback={fallback} />
      ) : item.imageUrl && failedUrl !== item.imageUrl ? (
        <img src={item.imageUrl} alt="" loading="lazy" decoding="async"
          referrerPolicy="no-referrer" className="size-full object-contain"
          onError={() => setFailedUrl(item.imageUrl!)} />
      ) : item.symbol ? <span>{item.symbol}</span> : fallback}
    </span>
  );
}

export function CommunicationBoard({
  onSelect, speech, voiceURI, rate, largeCards, isChildMode = false,
  onStartCommunication, modePending,
  onUnlockRequest, catalog = CATALOG_PICTOGRAMS, settings = DEFAULT_BOARD_SETTINGS,
}: CommunicationBoardProps) {
  const [query, setQuery] = useState("");
  const [selectedView, setView] = useState<View>("home");
  const view = selectedView === "quick" && !settings.quickPhrasesEnabled ? "home" : selectedView;
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const [sentence, setSentence] = useState<Pictogram[]>([]);
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const clearButton = useRef<HTMLButtonElement>(null);
  const composerHeading = useRef<HTMLHeadingElement>(null);
  const categoryHeading = useRef<HTMLHeadingElement>(null);
  const activeQuery = isChildMode ? "" : query.trim();
  const usingCategory = view === "categories" || view === "health";
  const showingQuick = !activeQuery && view === "quick" && settings.quickPhrasesEnabled;
  const categoryChoices = useMemo(() => {
    const available = (view === "health" ? HEALTH_CATEGORIES : [
      ...new Set<string>([...CATALOG_CATEGORIES, ...catalog.flatMap((item) => item.categories ?? [item.category])]),
    ]).filter((label) =>
      (view === "health" || !HEALTH_CATEGORIES.some((health) => health === label)) &&
      (settings.enabledCategories === null || settings.enabledCategories.includes(toCategoryId(label))));
    const preferred = new Set([...settings.categoryOrder, ...settings.favoriteCategories]);
    const byId = new Map(available.map((label) => [toCategoryId(label), label]));
    return [
      ...[...preferred].flatMap((id) => byId.has(id) ? [byId.get(id)!] : []),
      ...available.filter((label) => !preferred.has(toCategoryId(label))),
    ];
  }, [catalog, settings.categoryOrder, settings.enabledCategories, settings.favoriteCategories, view]);

  const results = useMemo(() => {
    if (activeQuery) return searchPictograms(catalog, activeQuery).sort((a, b) => {
      const priority = (item: Pictogram) =>
        Number(settings.favorites.includes(item.id)) * 2 + Number(item.source === "custom");
      return priority(b) - priority(a);
    });
    if (view === "home") {
      return orderedByIds(catalog, settings.homeSymbols ?? DEFAULT_HOME_SYMBOL_IDS);
    }
    if (view === "essential") return orderedByIds(catalog, ESSENTIAL_PICTOGRAM_IDS);
    if (view === "needs") return orderedByIds(catalog, NEEDS_PICTOGRAM_IDS);
    if (view === "favorites") return orderedByIds(catalog, settings.favorites);
    if (view === "custom") return catalog.filter((item) => item.source === "custom");
    if (!category || !categoryChoices.includes(category)) return [];
    const matching = catalog.filter((item) => categoryMatch(item, category));
    const customOrder = settings.symbolOrder[toCategoryId(category)] ?? [];
    const first = orderedByIds(matching, customOrder);
    const promoted = new Set(first.map((item) => item.id));
    return [...first, ...matching.filter((item) => !promoted.has(item.id))];
  }, [activeQuery, catalog, category, categoryChoices, settings.favorites, settings.homeSymbols, settings.symbolOrder, view]);

  const showingGroups = !activeQuery && usingCategory && !category;
  const resultCount = showingQuick ? settings.quickPhrases.length : results.length;
  const pageCount = Math.max(1, Math.ceil(resultCount / settings.pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  // Keep the configured maximum and balance the pages without changing order.
  const minPageSize = Math.floor(resultCount / pageCount);
  const fullerPages = resultCount % pageCount;
  const pageStart = visiblePage * minPageSize + Math.min(visiblePage, fullerPages);
  const pageEnd = pageStart + minPageSize + Number(visiblePage < fullerPages);
  const visible = useMemo(() => results.slice(pageStart, pageEnd), [results, pageStart, pageEnd]);
  const duplicateLabels = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const item of results) {
      if (seen.has(item.label)) duplicates.add(item.label);
      seen.add(item.label);
    }
    return duplicates;
  }, [results]);
  const spokenWords = useMemo(() => sentence.map(getPictogramSpeech), [sentence]);
  const containsPrivateSymbols = sentence.some((item) => item.privateSpeech);
  const requiresDevice = spokenWords.some((word) => !hasBundledSpeech(word)) ||
    sentence.some((item) => item.source === "custom");
  const { prefetch, prepareSentence } = speech;

  useEffect(() => {
    const safeWords = visible.filter((item) => !item.privateSpeech)
      .map(getPictogramSpeech).filter(hasBundledSpeech);
    if (safeWords.length) return prefetch(safeWords, { voiceURI, rate });
  }, [visible, prefetch, voiceURI, rate]);

  useEffect(() => {
    if (!spokenWords.length || requiresDevice) return;
    return prepareSentence(spokenWords, { voiceURI, rate });
  }, [spokenWords, requiresDevice, prepareSentence, voiceURI, rate]);

  function open(next: View) {
    setView(next);
    setCategory("");
    setQuery("");
    setPage(0);
  }

  function speakSymbol(pictogram: Pictogram) {
    const text = getPictogramSpeech(pictogram);
    const bundled = hasBundledSpeech(text);
    speech.speak(text, {
      voiceURI, rate,
      ...(pictogram.source === "custom" || (pictogram.privateSpeech && !bundled) ? { deviceOnly: true }
        : pictogram.privateSpeech ? { bundledOnly: true }
        : !bundled ? { preferDevice: true } : {}),
    });
  }

  function select(pictogram: Pictogram, speak = settings.speakOnSelect) {
    if (sentence.length >= settings.maxSentenceSymbols) {
      setLimitReached(true);
      return;
    }
    if (speak) speakSymbol(pictogram);
    setSentence((current) => current.length < settings.maxSentenceSymbols ? [...current, pictogram] : current);
    setLastSelected(pictogram.id);
    if (!pictogram.privateSpeech) onSelect(pictogram);
  }

  function phraseSymbol(phrase: BoardQuickPhrase): Pictogram {
    return {
      id: "phrase-" + phrase.id, label: phrase.label, spokenText: phrase.text,
      symbol: "", category: "Frases rápidas", color: "#f4effb", privateSpeech: true,
    };
  }

  function remove(index: number) {
    speech.stop();
    setSentence((current) => current.filter((_, position) => position !== index));
    setLastSelected(null);
    setLimitReached(false);
    if (sentence.length === 1) {
      setConfirmClear(false);
      composerHeading.current?.focus();
    }
  }

  function closeClear(reset: boolean) {
    setConfirmClear(false);
    if (reset) {
      speech.stop();
      setSentence([]);
      setLastSelected(null);
      setLimitReached(false);
      composerHeading.current?.focus();
    } else clearButton.current?.focus();
  }

  function playSentence() {
    if (!sentence.length || !speech.supported) return;
    speech.speak(spokenWords.join(" "), {
      voiceURI, rate, segments: spokenWords,
      ...(requiresDevice ? { deviceOnly: true } : { bundledOnly: true }),
    });
    // Keep existing per-symbol history while omitting sensitive messages.
    if (!containsPrivateSymbols) sentence.forEach((pictogram) => onSelect(pictogram));
  }

  const cardSize = isChildMode || largeCards ? "large" : settings.cardSize;
  const boardStyle = {
    "--board-cols": settings.columns,
    "--board-mobile-cols": Math.min(settings.columns, 3),
    "--board-gap": { compact: "0.5rem", regular: "0.75rem", loose: "1.25rem" }[settings.spacing],
  } as CSSProperties;
  const sectionTitle = activeQuery ? "Resultados da busca" :
    category || VIEWS.find(([key]) => key === view)?.[1];
  const imageSize = isChildMode && settings.imageSize !== "large" ? "regular" : settings.imageSize;

  return (
    <div className={settings.contrast ? "board-contrast space-y-2 rounded-3xl bg-stone-200 p-2 text-black" : "space-y-2"}>
      <section className="surface p-2 sm:px-3" aria-labelledby="sentence-title">
        <h2 ref={composerHeading} id="sentence-title" tabIndex={-1} className="sr-only">O que vamos comunicar?</h2>
        {sentence.length > 0 && <div className="mb-2 flex max-h-[min(26dvh,9rem)] flex-wrap gap-1 overflow-y-auto rounded-xl bg-brand-50 p-1.5"
          role="group" aria-label="Símbolos da frase" tabIndex={sentence.length > 6 ? 0 : undefined}>
          {sentence.map((item, index) => (
            <span key={item.id + "-" + index}
              className="inline-flex max-w-full items-center gap-1 rounded-xl border border-brand-100 bg-white pl-2 text-sm font-medium">
              <PictogramPicture item={item} compact />
              <span className="min-w-0 break-words">{item.label}</span>
              <button type="button" aria-label={"Remover " + item.label + " da posição " + (index + 1)}
                onClick={() => remove(index)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-stone-600 hover:bg-brand-50">
                <X size={16} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>}
        <div className="flex min-h-11 flex-wrap items-center gap-1.5">
          {!sentence.length && <p className="me-auto px-1 text-sm text-stone-600">Toque em um símbolo.</p>}
          <button type="button" className="board-control board-control-active" disabled={!sentence.length || !speech.supported}
            onClick={playSentence}>
            <Volume2 size={18} aria-hidden="true" /> Ouvir frase
          </button>
          {sentence.length > 0 && <>
            <button type="button" className="board-control" aria-label="Remover último" onClick={() => remove(sentence.length - 1)}>
              <Undo2 size={16} aria-hidden="true" /> <span><span className="hidden sm:inline">Remover </span>último</span>
            </button>
            <button ref={clearButton} type="button" className="board-control" aria-expanded={confirmClear}
              onClick={() => setConfirmClear(true)}>
              Limpar
            </button>
          </>}
          {speech.speaking && <button type="button" className="board-control" onClick={speech.stop}>
            <Square size={15} aria-hidden="true" /> Parar áudio
          </button>}
          {speech.needsPlaybackGesture && <button type="button" className="board-control" onClick={speech.retryPlayback}>
            <Volume2 size={18} aria-hidden="true" /> Ouvir áudio pronto
          </button>}
          {isChildMode && <button type="button" onClick={onUnlockRequest}
            aria-label="Sair do modo comunicação"
            className="board-control ml-auto">
            <LockKeyhole size={20} aria-hidden="true" />
            Sair
          </button>}
        </div>
        <span className="sr-only" role="status">{sentence.length} símbolos na frase.</span>
        {confirmClear && <div role="group" aria-label="Confirmar limpeza da frase"
          className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 p-2"
          onKeyDown={(event) => { if (event.key === "Escape") closeClear(false); }}>
          <p className="grow text-sm font-medium">Limpar todos os símbolos da frase?</p>
          <button type="button" className="board-control" autoFocus onClick={() => closeClear(false)}>Manter frase</button>
          <button type="button" className="board-control board-control-active" onClick={() => closeClear(true)}>Limpar frase</button>
        </div>}
        {limitReached && <p role="status" className="mt-2 text-sm text-brand-700">
          A frase tem o limite de {settings.maxSentenceSymbols} símbolos. Remova um para continuar.
        </p>}
        {!speech.supported && <p className="mt-2 text-sm text-stone-600">
          A leitura em voz alta está indisponível. Os símbolos continuam acessíveis.
        </p>}
        {speech.error && <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">{speech.error}</p>}
      </section>

      <section aria-labelledby="symbols-title" className="space-y-2">
        {!isChildMode && <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-28 grow basis-0 sm:max-w-80">
            <Search size={18} aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
            <label htmlFor="symbol-search" className="sr-only">Buscar símbolo</label>
            <input id="symbol-search" type="search" className="input-field min-h-11 py-1 pl-9"
              placeholder="Buscar símbolo…" value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
          </div>
          {onStartCommunication && <button type="button" className="board-control ml-auto"
            aria-label="Iniciar modo comunicação" disabled={modePending} onClick={onStartCommunication}>
            <LockKeyhole size={17} aria-hidden="true" /> Modo comunicação
          </button>}
        </div>}
        <div role="group" aria-label="Áreas da prancha" className="grid grid-cols-3 gap-1 min-[360px]:grid-cols-4 sm:flex sm:flex-wrap">
          {VIEWS.filter(([key]) => key !== "quick" || settings.quickPhrasesEnabled).map(([key, label, shortLabel]) => (
            <button type="button" key={key} aria-pressed={!activeQuery && view === key}
              aria-label={label}
              className={!activeQuery && view === key ? "board-control board-control-active px-1" : "board-control px-1"}
              onClick={() => open(key)}>{shortLabel ?? label}</button>
          ))}
        </div>
        <div className={category && !activeQuery ? "flex flex-wrap items-center gap-2" : undefined}>
          {!activeQuery && usingCategory && category && (
            <button type="button" className="board-control"
              onClick={() => { open(view); requestAnimationFrame(() => categoryHeading.current?.focus()); }}>
              <ArrowLeft size={17} aria-hidden="true" /> Voltar às categorias
            </button>
          )}
          <h2 ref={categoryHeading} id="symbols-title" tabIndex={-1}
            className={category || activeQuery ? "break-words text-base font-semibold" : "sr-only"}>
            {sectionTitle}
          </h2>
        </div>
        {pageCount > 1 && (
          <div role="group" aria-label="Páginas de símbolos" className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
            <button type="button" className="board-control" disabled={visiblePage === 0}
              onClick={() => setPage(visiblePage - 1)} aria-label="Página anterior">
              <ArrowLeft size={18} aria-hidden="true" /> Anterior
            </button>
            <span role="status" className="text-sm">Página {visiblePage + 1} de {pageCount}</span>
            <button type="button" className="board-control" disabled={visiblePage === pageCount - 1}
              onClick={() => setPage(visiblePage + 1)} aria-label="Próxima página">
              Próxima <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        {showingGroups ? (
          categoryChoices.length ? <div className="grid gap-2 min-[360px]:grid-cols-2 lg:grid-cols-3">
            {categoryChoices.map((label) => <button key={label} type="button"
              className="board-control justify-between text-left"
              onClick={() => { setCategory(label); setPage(0); requestAnimationFrame(() => categoryHeading.current?.focus()); }}>
              <span>{label}</span>
              {settings.favoriteCategories.includes(toCategoryId(label)) && <Star size={15} className="text-brand-700" aria-hidden="true" />}
              <ArrowRight size={17} aria-hidden="true" />
            </button>)}
          </div> : <p role="status" className="surface p-4">Nenhuma categoria habilitada.</p>
        ) : showingQuick ? (
          settings.quickPhrases.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {settings.quickPhrases.slice(pageStart, pageEnd).map((phrase) => (
              <article className="surface flex min-w-0 flex-col gap-2 rounded-2xl p-2.5" key={phrase.id}>
                <p className="break-words px-1 font-semibold">{phrase.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="board-control board-control-active" disabled={!speech.supported}
                    aria-label={"Ouvir: " + phrase.label}
                    onClick={() => speakSymbol(phraseSymbol(phrase))}><Volume2 size={17} aria-hidden="true" /> Ouvir</button>
                  <button type="button" className="board-control" aria-label={"Adicionar à frase: " + phrase.label}
                    onClick={() => select(phraseSymbol(phrase), false)}><Plus size={17} aria-hidden="true" /> Adicionar</button>
                </div>
              </article>
            ))}
          </div> : <p role="status" className="surface p-4">Nenhuma frase rápida cadastrada.</p>
        ) : visible.length ? (
          <>
            <div className="board-card-grid" style={boardStyle}>
              {visible.map((item) => (
                <button key={item.id} type="button"
                  aria-label={(settings.speakOnSelect ? "Falar " : "Adicionar ") + item.label + (duplicateLabels.has(item.label) ? " (" + item.category + ")" : "")}
                  aria-pressed={lastSelected === item.id} onClick={() => select(item)}
                  className={[
                    "relative flex min-w-0 flex-col items-center justify-center gap-2 rounded-3xl border-2 bg-white p-2 transition duration-150 hover:shadow-md active:bg-purple-200 active:scale-95 active:duration-0 motion-reduce:active:scale-100",
                    { compact: "min-h-20", regular: "min-h-26", large: "min-h-28 sm:min-h-36" }[cardSize],
                    lastSelected === item.id ? "border-brand-600 bg-brand-50"
                      : settings.contrast ? "border-black text-black" : "border-stone-200 text-ink",
                  ].join(" ")}>
                  {lastSelected === item.id && <Check size={16} className="absolute right-2 top-2 text-brand-700" aria-hidden="true" />}
                  <PictogramPicture item={item} size={imageSize} />
                  <span className={["max-w-full break-words font-semibold leading-snug", {
                    regular: "text-base", large: "text-lg", extra: "text-xl",
                  }[settings.labelSize]].join(" ")}>{item.label}</span>
                  {activeQuery && <span className="text-xs text-stone-600">{item.category}</span>}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p role="status" className="surface p-4">
            {activeQuery ? "Nenhum símbolo encontrado. Tente outra palavra."
              : "Nenhum símbolo nesta área."}
          </p>
        )}
        {sentence.length > 0 && <div className="flex justify-end">
          <button type="button" className="board-control" onClick={() => composerHeading.current?.focus()}>Voltar à frase</button>
        </div>}
      </section>
    </div>
  );
}
