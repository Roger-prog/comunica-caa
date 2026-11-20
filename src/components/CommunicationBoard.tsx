import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft, Camera, Check, ChevronLeft, ChevronRight, Droplets, House, LayoutGrid, LockKeyhole,
  MessageCircle, Plus, Pointer, Search, Sparkles, Square, Star, Stethoscope, Trash2, Undo2, Volume2, X,
  type LucideIcon,
} from "lucide-react";
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
import { PictogramPicture } from "./PictogramPicture";
import { SpeechFeedback } from "./SpeechFeedback";
import { LibrasPanel } from "./LibrasPanel";

interface CommunicationBoardProps {
  onSelect: (pictogram: Pictogram) => void;
  onPlayback: (message: string) => void;
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

/** Cores fortes e bem diferentes entre si: a criança reconhece a área pela cor, sem precisar ler. */
const PALETTE = [
  { bg: "#f2b705", ink: "#2b2100" }, { bg: "#2fa84f", ink: "#111111" }, { bg: "#ef6a2f", ink: "#111111" },
  { bg: "#2f80d8", ink: "#111111" }, { bg: "#8b57c6", ink: "#ffffff" }, { bg: "#e04d7c", ink: "#111111" },
  { bg: "#12a39a", ink: "#111111" }, { bg: "#995f35", ink: "#ffffff" },
] as const;

const VIEW_STYLE: Record<View, { bg: string; ink: string; Icon: LucideIcon }> = {
  home: { bg: "#27408b", ink: "#ffffff", Icon: House },
  essential: { bg: "#2fa84f", ink: "#111111", Icon: Sparkles },
  needs: { bg: "#ef6a2f", ink: "#111111", Icon: Droplets },
  categories: { bg: "#8b57c6", ink: "#ffffff", Icon: LayoutGrid },
  health: { bg: "#e04d7c", ink: "#111111", Icon: Stethoscope },
  favorites: { bg: "#f2b705", ink: "#2b2100", Icon: Star },
  custom: { bg: "#12a39a", ink: "#111111", Icon: Camera },
  quick: { bg: "#2f80d8", ink: "#111111", Icon: MessageCircle },
};

function categoryPalette(label: string) {
  const index = CATALOG_CATEGORIES.indexOf(label);
  if (index >= 0) return PALETTE[index % PALETTE.length];
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function colorVars(color: { bg: string; ink: string }) {
  return { "--c": color.bg, "--ink": color.ink } as CSSProperties;
}

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

export function CommunicationBoard({
  onSelect, onPlayback, speech, voiceURI, rate, largeCards, isChildMode = false,
  onStartCommunication, modePending,
  onUnlockRequest, catalog = CATALOG_PICTOGRAMS, settings = DEFAULT_BOARD_SETTINGS,
}: CommunicationBoardProps) {
  const [query, setQuery] = useState("");
  const [selectedView, setView] = useState<View>("home");
  const view = selectedView === "quick" && !settings.quickPhrasesEnabled ? "home" : selectedView;
  const [selectedCategory, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const [sentence, setSentence] = useState<Pictogram[]>([]);
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [oopsFlash, setOopsFlash] = useState(false);
  const oopsTimer = useRef<number>(0);
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

  const category = categoryChoices.includes(selectedCategory) ? selectedCategory : "";

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
    if (!category) return [];
    const matching = catalog.filter((item) => categoryMatch(item, category));
    const customOrder = settings.symbolOrder[toCategoryId(category)] ?? [];
    const first = orderedByIds(matching, customOrder);
    const promoted = new Set(first.map((item) => item.id));
    return [...first, ...matching.filter((item) => !promoted.has(item.id))];
  }, [activeQuery, catalog, category, settings.favorites, settings.homeSymbols, settings.symbolOrder, view]);

  const showingGroups = !activeQuery && usingCategory && !category;
  const resultCount = showingQuick ? settings.quickPhrases.length : results.length;
  const pageCount = Math.max(1, Math.ceil(resultCount / settings.pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const pageStart = visiblePage * settings.pageSize;
  const pageEnd = pageStart + settings.pageSize;
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
  const canPrepare = sentence.every((item) => !item.privateSpeech) && spokenWords.every(hasBundledSpeech);
  const { prefetch, prepareSentence } = speech;

  useEffect(() => {
    if (page !== visiblePage) setPage(visiblePage);
  }, [page, visiblePage]);

  useEffect(() => {
    const safeWords = visible.filter((item) => !item.privateSpeech)
      .map(getPictogramSpeech).filter(hasBundledSpeech);
    if (safeWords.length) return prefetch(safeWords, { voiceURI, rate, offlineOnly: true });
  }, [visible, prefetch, voiceURI, rate]);

  useEffect(() => {
    if (!spokenWords.length || !canPrepare) return;
    return prepareSentence(spokenWords, { voiceURI, rate });
  }, [spokenWords, canPrepare, prepareSentence, voiceURI, rate]);

  function open(next: View) {
    setView(next);
    setCategory("");
    setQuery("");
    setPage(0);
  }

  function playMessage(segments: readonly string[]) {
    const text = segments.join(" ");
    let started = false;
    speech.speak(text, {
      voiceURI, rate, segments, offlineOnly: true,
      onStart: () => {
        if (started) return;
        started = true;
        onPlayback(text);
      },
    });
  }

  function select(pictogram: Pictogram, quickPhrase = false) {
    if (sentence.length >= settings.maxSentenceSymbols) {
      setLimitReached(true);
      return;
    }
    if (!quickPhrase && settings.speakOnSelect) {
      speech.speak(getPictogramSpeech(pictogram), { voiceURI, rate, offlineOnly: true });
    }
    setSentence((current) => current.length < settings.maxSentenceSymbols ? [...current, pictogram] : current);
    setLastSelected(pictogram.id);
    if (!quickPhrase) onSelect(pictogram);
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
    if (sentence.length && speech.supported) playMessage(spokenWords);
  }

  useEffect(() => () => window.clearTimeout(oopsTimer.current), []);

  const yesItem = useMemo(() => catalog.find((item) => item.id === "sim"), [catalog]);
  const noItem = useMemo(() => catalog.find((item) => item.id === "nao"), [catalog]);
  const categoryImages = useMemo(() => {
    const images = new Map<string, Pictogram>();
    for (const item of catalog) {
      if (!item.imageUrl && !item.imagePath && !item.symbol) continue;
      for (const label of item.categories ?? [item.category]) if (!images.has(label)) images.set(label, item);
    }
    return images;
  }, [catalog]);

  /** "Opa!": a criança tocou na figura errada — tira a última figura e sacode a tira da frase. */
  function oops() {
    if (!sentence.length) return;
    remove(sentence.length - 1);
    setOopsFlash(true);
    window.clearTimeout(oopsTimer.current);
    oopsTimer.current = window.setTimeout(() => setOopsFlash(false), 600);
  }

  const cardSize = isChildMode || largeCards ? "large" : settings.cardSize;
  const boardStyle = {
    "--board-cols": settings.columns,
    "--board-mobile-cols": Math.min(settings.columns, 2),
    "--board-gap": { compact: "0.5rem", regular: "0.75rem", loose: "1.25rem" }[settings.spacing],
  } as CSSProperties;
  const sectionTitle = activeQuery ? "Resultados da busca" :
    category || VIEWS.find(([key]) => key === view)?.[1];
  const imageSize = isChildMode && settings.imageSize !== "large" ? "regular" : settings.imageSize;

  const labelSize = isChildMode && settings.labelSize === "regular" ? "large" : settings.labelSize;
  const showPageButtons = isChildMode || pageCount > 1;
  const visibleViews = VIEWS.filter(([key]) => key !== "quick" || settings.quickPhrasesEnabled);

  return (
    <div className={settings.contrast ? "board-contrast kid-board rounded-3xl bg-stone-200 p-2 text-black" : "kid-board"}
      style={boardStyle}>
      <div className="kid-top">
        {yesItem && <button type="button" className="kid-answer order-2 md:order-1" style={colorVars({ bg: "#2f9e44", ink: "#111" })}
          aria-label="Responder sim" onClick={() => select(yesItem)}>
          <Check size={44} strokeWidth={4} aria-hidden="true" /><span>sim</span>
        </button>}

        <section className={"kid-strip order-1 col-span-2 md:order-2 md:col-span-1" + (oopsFlash ? " kid-oops" : "")}
          aria-labelledby="sentence-title">
          <h2 ref={composerHeading} id="sentence-title" tabIndex={-1} className="sr-only">O que vamos comunicar?</h2>
          <div className="kid-strip-row">
            <div className="kid-slots" role="group" aria-label="Símbolos da frase"
              tabIndex={sentence.length > 6 ? 0 : undefined}>
              {sentence.length === 0 && <>
                <Pointer size={36} className="text-stone-400" aria-hidden="true" />
                <p className={isChildMode ? "sr-only" : "px-1 text-base text-stone-600"}>Toque em um símbolo.</p>
              </>}
              {sentence.map((item, index) => (
                <span key={item.id + "-" + index} className="kid-slot"
                  style={colorVars(categoryPalette(item.category))}>
                  <PictogramPicture item={item} size="small" big plain />
                  <span className="kid-slot-label">{item.label}</span>
                  {!isChildMode && <button type="button" aria-label={"Remover " + item.label + " da posição " + (index + 1)}
                    onClick={() => remove(index)} className="kid-slot-remove">
                    <X size={16} aria-hidden="true" />
                  </button>}
                </span>
              ))}
            </div>
            <div className="kid-strip-actions">
              <button type="button" className="kid-play" disabled={!sentence.length || !speech.supported}
                onClick={playSentence}>
                <Volume2 size={34} aria-hidden="true" /> <span>Ouvir frase</span>
              </button>
              {speech.speaking && <button type="button" className="board-control" onClick={speech.stop}>
                <Square size={15} aria-hidden="true" /> Parar áudio
              </button>}
              {sentence.length > 0 && <button ref={clearButton} type="button" className="board-control" aria-expanded={confirmClear}
                onClick={() => setConfirmClear(true)}>
                <Trash2 size={16} aria-hidden="true" /> Limpar
              </button>}
            </div>
          </div>
          <span className="sr-only" role="status">{sentence.length} símbolos na frase.</span>
          {confirmClear && <div role="group" aria-label="Confirmar limpeza da frase"
            className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl bg-brand-50 p-2"
            onKeyDown={(event) => { if (event.key === "Escape") closeClear(false); }}>
            <p className="grow text-base font-semibold">Limpar todos os símbolos da frase?</p>
            <button type="button" className="board-control" autoFocus onClick={() => closeClear(false)}>Manter frase</button>
            <button type="button" className="board-control board-control-active" onClick={() => closeClear(true)}>Limpar frase</button>
          </div>}
          {limitReached && <p role="status" className="mt-2 text-sm text-brand-700">
            A frase tem o limite de {settings.maxSentenceSymbols} símbolos. Remova um para continuar.
          </p>}
          {!speech.supported && <p className="mt-2 text-sm text-stone-600">
            A leitura em voz alta está indisponível. Os símbolos continuam acessíveis.
          </p>}
          <SpeechFeedback speech={speech} compact />
          {sentence.length > 0 && !isChildMode && <LibrasPanel key={spokenWords.join(" ")} phrase={spokenWords.join(" ")} />}
        </section>

        {noItem && <button type="button" className="kid-answer order-3" style={colorVars({ bg: "#c92a2a", ink: "#fff" })}
          aria-label="Responder não" onClick={() => select(noItem)}>
          <X size={44} strokeWidth={4} aria-hidden="true" /><span>não</span>
        </button>}
      </div>

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

      <div className="kid-body">
        <section aria-labelledby="symbols-title" className="kid-cards">
          <div className={category && !activeQuery ? "flex flex-wrap items-center gap-2" : undefined}>
            {!activeQuery && usingCategory && category && (
              <button type="button" className="kid-back"
                onClick={() => { open(view); requestAnimationFrame(() => categoryHeading.current?.focus()); }}>
                <ArrowLeft size={22} aria-hidden="true" /> Voltar às categorias
              </button>
            )}
            <h2 ref={categoryHeading} id="symbols-title" tabIndex={-1}
              className={category || activeQuery ? "break-words text-xl font-bold" : "sr-only"}>
              {sectionTitle}
            </h2>
          </div>

          {!activeQuery && view === "categories" && <button type="button" className="board-control self-start"
            disabled={!speech.supported} onClick={() => playMessage(["Não está no meu livro, mas vou dar uma dica"])}>
            <MessageCircle size={20} aria-hidden="true" /> Não está no meu livro, mas vou dar uma dica
          </button>}

          {showingGroups ? (
            categoryChoices.length ? <div className="kid-folders">
              {categoryChoices.map((label) => {
                const image = categoryImages.get(label);
                return <button key={label} type="button" className="kid-folder" style={colorVars(categoryPalette(label))}
                  onClick={() => { setCategory(label); setPage(0); requestAnimationFrame(() => categoryHeading.current?.focus()); }}>
                  {image && <PictogramPicture item={image} size="small" big plain />}
                  <span>{label}</span>
                  {settings.favoriteCategories.includes(toCategoryId(label)) && <Star size={18} aria-hidden="true" />}
                </button>;
              })}
            </div> : <p role="status" className="surface p-4">Nenhuma categoria habilitada.</p>
          ) : showingQuick ? (
            settings.quickPhrases.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {settings.quickPhrases.slice(pageStart, pageEnd).map((phrase) => (
                <article className="kid-phrase" key={phrase.id}>
                  <p className="break-words px-1 text-lg font-bold">{phrase.label}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="kid-phrase-play" disabled={!speech.supported}
                      aria-label={"Ouvir: " + phrase.label}
                      onClick={() => playMessage([phrase.text])}><Volume2 size={22} aria-hidden="true" /> Ouvir</button>
                    <button type="button" className="board-control" aria-label={"Adicionar à frase: " + phrase.label}
                      onClick={() => select(phraseSymbol(phrase), true)}><Plus size={18} aria-hidden="true" /> Adicionar</button>
                  </div>
                </article>
              ))}
            </div> : <p role="status" className="surface p-4">Nenhuma frase rápida cadastrada.</p>
          ) : visible.length ? (
            <div className="board-card-grid">
              {visible.map((item) => (
                <button key={item.id} type="button"
                  aria-label={(settings.speakOnSelect ? "Falar " : "Adicionar ") + item.label + (duplicateLabels.has(item.label) ? " (" + item.category + ")" : "")}
                  aria-pressed={lastSelected === item.id} onClick={() => select(item)}
                  style={colorVars(categoryPalette(item.category))}
                  className={[
                    "kid-card relative flex min-w-0 flex-col items-center justify-center gap-1.5 p-2 transition duration-150 hover:shadow-md active:bg-purple-200 active:scale-95 active:duration-0 motion-reduce:active:scale-100",
                    { compact: "min-h-24", regular: "min-h-32", large: "min-h-36 sm:min-h-44" }[cardSize],
                    lastSelected === item.id ? "kid-card-on" : "",
                  ].join(" ")}>
                  {lastSelected === item.id && <Check size={22} strokeWidth={4} className="kid-card-check" aria-hidden="true" />}
                  <PictogramPicture item={item} size={imageSize} big plain />
                  <span className={["max-w-full break-words font-bold leading-snug", {
                    regular: "text-lg", large: "text-xl", extra: "text-2xl",
                  }[labelSize]].join(" ")}>{item.label}</span>
                  {activeQuery && <span className="text-xs text-stone-600">{item.category}</span>}
                </button>
              ))}
            </div>
          ) : (
            <p role="status" className="surface p-4">
              {activeQuery ? "Nenhum símbolo encontrado. Tente outra palavra."
                : "Nenhum símbolo nesta área."}
            </p>
          )}
          {sentence.length > 0 && !isChildMode && <div className="flex justify-end">
            <button type="button" className="board-control" onClick={() => composerHeading.current?.focus()}>Voltar à frase</button>
          </div>}
        </section>

        <div role="group" aria-label="Áreas da prancha" className="kid-tabs">
          {visibleViews.map(([key, label, shortLabel]) => {
            const { Icon, ...tone } = VIEW_STYLE[key];
            const on = !activeQuery && view === key;
            return <button type="button" key={key} aria-pressed={on} aria-label={label}
              className={on ? "kid-tab kid-tab-on" : "kid-tab"} style={colorVars(tone)}
              onClick={() => open(key)}>
              <Icon size={30} aria-hidden="true" />
              <span>{shortLabel ?? label}</span>
            </button>;
          })}
        </div>
      </div>

      <div role="group" aria-label="Controles da prancha" className="kid-dock">
        {showPageButtons && <button type="button" className="kid-dock-btn kid-page" disabled={visiblePage === 0}
          onClick={() => setPage(visiblePage - 1)} aria-label="Página anterior">
          <ChevronLeft size={44} strokeWidth={4} aria-hidden="true" /> <span>Anterior</span>
        </button>}
        <button type="button" className="kid-dock-btn kid-oops-btn" disabled={!sentence.length}
          aria-label="Remover último" onClick={oops}>
          <Undo2 size={40} strokeWidth={3.5} aria-hidden="true" /> <span>Opa!</span>
        </button>
        {showPageButtons && <button type="button" className="kid-dock-btn kid-page" disabled={visiblePage === pageCount - 1}
          onClick={() => setPage(visiblePage + 1)} aria-label="Próxima página">
          <span>Próxima</span> <ChevronRight size={44} strokeWidth={4} aria-hidden="true" />
        </button>}
        {pageCount > 1 && <>
          <span role="status" className={isChildMode ? "sr-only" : "kid-dock-status"}>Página {visiblePage + 1} de {pageCount}</span>
          {isChildMode && <span className="kid-dots" aria-hidden="true">
            {Array.from({ length: pageCount }, (_, dot) => <i key={dot} className={dot === visiblePage ? "on" : ""} />)}
          </span>}
        </>}
        {isChildMode && <button type="button" onClick={onUnlockRequest} aria-label="Sair do modo comunicação"
          className="kid-exit">
          <LockKeyhole size={20} aria-hidden="true" /> Sair
        </button>}
      </div>
    </div>
  );
}
