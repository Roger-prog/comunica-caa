import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, ImageOff, LockKeyhole, Search, Square, Volume2, X } from "lucide-react";
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
import { DEFAULT_BOARD_SETTINGS, type BoardSettings } from "../lib/patientBoard";
import { PatientPhoto } from "./PatientPhoto";

interface CommunicationBoardProps {
  onSelect: (pictogram: Pictogram) => void;
  speech: ReturnType<typeof useSpeech>;
  voiceURI: string;
  rate: number;
  largeCards: boolean;
  isChildMode?: boolean;
  onUnlockRequest?: () => void;
  catalog?: readonly Pictogram[];
  settings?: BoardSettings;
}

const VIEWS = [
  ["home", "Início"], ["essential", "Vocabulário essencial"], ["needs", "Necessidades"],
  ["categories", "Categorias"], ["health", "Saúde"], ["favorites", "Favoritos"],
  ["custom", "Meus símbolos"],
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
  onUnlockRequest, catalog = CATALOG_PICTOGRAMS, settings = DEFAULT_BOARD_SETTINGS,
}: CommunicationBoardProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("home");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const [sentence, setSentence] = useState<Pictogram[]>([]);
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const activeQuery = isChildMode ? "" : query.trim();
  const usingCategory = view === "categories" || view === "health";
  const categoryChoices = useMemo(() => {
    const available = (view === "health" ? HEALTH_CATEGORIES : [
      ...new Set<string>([...CATALOG_CATEGORIES, ...catalog.flatMap((item) => item.categories ?? [item.category])]),
    ]).filter((label) =>
      (view === "health" || !HEALTH_CATEGORIES.some((health) => health === label)) &&
      (settings.enabledCategories === null || settings.enabledCategories.includes(toCategoryId(label))));
    const preferred = new Set([...settings.favoriteCategories, ...settings.categoryOrder]);
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
  const pageCount = Math.max(1, Math.ceil(results.length / settings.pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const visible = useMemo(() => results.slice(
    visiblePage * settings.pageSize, (visiblePage + 1) * settings.pageSize,
  ), [results, settings.pageSize, visiblePage]);
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

  function select(pictogram: Pictogram) {
    const text = getPictogramSpeech(pictogram);
    const bundled = hasBundledSpeech(text);
    speech.speak(text, {
      voiceURI, rate,
      ...(pictogram.source === "custom" || (pictogram.privateSpeech && !bundled) ? { deviceOnly: true }
        : pictogram.privateSpeech ? { bundledOnly: true }
        : !bundled ? { preferDevice: true } : {}),
    });
    setSentence((current) => [...current.slice(-11), pictogram]);
    setLastSelected(pictogram.id);
    if (!pictogram.privateSpeech) onSelect(pictogram);
  }

  function remove(index: number) {
    speech.stop();
    setSentence((current) => current.filter((_, position) => position !== index));
    setLastSelected(null);
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

  const cardSize = largeCards ? "large" : settings.cardSize;
  const boardStyle = {
    "--board-cols": settings.columns,
    "--board-mobile-cols": Math.min(settings.columns, 3),
    "--board-gap": { compact: "0.5rem", regular: "0.75rem", loose: "1.25rem" }[settings.spacing],
  } as CSSProperties;
  const sectionTitle = activeQuery ? "Resultados da busca" :
    category || VIEWS.find(([key]) => key === view)?.[1];

  return (
    <div className={settings.contrast ? "board-contrast space-y-4 rounded-3xl bg-stone-200 p-2 text-black" : "space-y-4"}>
      <section className="surface sticky top-2 z-10 p-3 shadow-sm sm:p-4" aria-labelledby="sentence-title">
        <div className={isChildMode ? "sr-only" : "mb-3 flex flex-wrap items-center justify-between gap-2"}>
          <h2 id="sentence-title" className="text-sm font-semibold text-brand-700">O que vamos comunicar?</h2>
          <span className="text-xs text-stone-600">Até 12 símbolos</span>
        </div>
        <div aria-live="polite" className="flex min-h-14 gap-2 overflow-x-auto rounded-2xl bg-brand-50 p-2">
          {sentence.length ? sentence.map((item, index) => (
            <span key={item.id + "-" + index}
              className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-brand-100 bg-white pl-2 text-sm font-medium">
              <PictogramPicture item={item} compact />
              {item.label}
              <button type="button" aria-label={"Remover " + item.label + " da posição " + (index + 1)}
                onClick={() => remove(index)}
                className="inline-flex size-11 items-center justify-center rounded-lg text-stone-600 hover:bg-brand-50">
                <X size={16} aria-hidden="true" />
              </button>
            </span>
          )) : <p className="self-center px-1 text-sm text-stone-600">Toque em um símbolo.</p>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="button-primary" disabled={!sentence.length || !speech.supported}
            onClick={playSentence}>
            <Volume2 size={18} aria-hidden="true" /> Ouvir frase
          </button>
          <button type="button" className="button-secondary" disabled={!sentence.length}
            onClick={() => remove(sentence.length - 1)}>Remover último</button>
          <button type="button" className="button-secondary" disabled={!sentence.length}
            onClick={() => { speech.stop(); setSentence([]); setLastSelected(null); }}>
            Limpar
          </button>
          {speech.speaking && <button type="button" className="button-secondary" onClick={speech.stop}>
            <Square size={15} aria-hidden="true" /> Parar áudio
          </button>}
          {speech.needsPlaybackGesture && <button type="button" className="button-secondary" onClick={speech.retryPlayback}>
            <Volume2 size={18} aria-hidden="true" /> Ouvir áudio pronto
          </button>}
          {isChildMode && <button type="button" onClick={onUnlockRequest}
            aria-label="Desbloquear modo criança"
            className="ml-auto flex size-12 shrink-0 items-center justify-center rounded-xl text-stone-600 hover:bg-brand-50">
            <LockKeyhole size={20} aria-hidden="true" />
          </button>}
        </div>
        {!speech.supported && <p className="mt-2 text-sm text-stone-600">
          A leitura em voz alta está indisponível. Os símbolos continuam acessíveis.
        </p>}
        {speech.error && <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">{speech.error}</p>}
      </section>

      <section aria-labelledby="symbols-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="symbols-title" className={isChildMode ? "sr-only" : "text-xl font-semibold"}>
            {sectionTitle}
          </h2>
          {!isChildMode && <div className="relative w-full sm:max-w-72">
            <Search size={18} aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-500" />
            <label htmlFor="symbol-search" className="sr-only">Buscar símbolo</label>
            <input id="symbol-search" type="search" className="input-field pl-11"
              placeholder="Buscar símbolo…" value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
          </div>}
        </div>
        <div role="group" aria-label="Áreas da prancha" className="mb-4 flex flex-wrap gap-2">
          {VIEWS.map(([key, label]) => (
            <button type="button" key={key} aria-pressed={!activeQuery && view === key}
              className={!activeQuery && view === key ? "button-primary" : "button-secondary"}
              onClick={() => open(key)}>{label}</button>
          ))}
        </div>

        {!activeQuery && usingCategory && category && (
          <button type="button" className="button-secondary mb-3"
            onClick={() => open(view)}>
            <ArrowLeft size={17} aria-hidden="true" /> {category} · Voltar aos grupos
          </button>
        )}
        {showingGroups ? (
          categoryChoices.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {categoryChoices.map((label) => <button key={label} type="button"
              className="button-secondary justify-between text-left"
              onClick={() => { setCategory(label); setPage(0); }}>
              <span>{label}</span><ArrowRight size={17} aria-hidden="true" />
            </button>)}
          </div> : <p role="status" className="surface p-4">Nenhuma categoria habilitada.</p>
        ) : visible.length ? (
          <>
            <div className="board-card-grid" style={boardStyle}>
              {visible.map((item) => (
                <button key={item.id} type="button"
                  aria-label={"Falar " + item.label + (duplicateLabels.has(item.label) ? " (" + item.category + ")" : "")}
                  aria-pressed={lastSelected === item.id} onClick={() => select(item)}
                  className={[
                    "relative flex min-w-0 flex-col items-center justify-center gap-2 rounded-3xl border-2 bg-white p-2 transition duration-150 hover:shadow-md active:bg-purple-200 active:scale-95 active:duration-0 motion-reduce:active:scale-100",
                    { compact: "min-h-24", regular: "min-h-32", large: "min-h-36 sm:min-h-44" }[cardSize],
                    lastSelected === item.id ? "border-brand-600 bg-brand-50"
                      : settings.contrast ? "border-black text-black" : "border-stone-200 text-ink",
                  ].join(" ")}>
                  {lastSelected === item.id && <Check size={16} className="absolute right-2 top-2 text-brand-700" aria-hidden="true" />}
                  <PictogramPicture item={item} size={settings.imageSize} />
                  <span className={["max-w-full break-words font-semibold leading-snug", {
                    regular: "text-base", large: "text-lg", extra: "text-xl",
                  }[settings.labelSize]].join(" ")}>{item.label}</span>
                  {activeQuery && <span className="text-xs text-stone-600">{item.category}</span>}
                </button>
              ))}
            </div>
            {pageCount > 1 && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <button type="button" className="button-secondary" disabled={visiblePage === 0}
                  onClick={() => setPage(visiblePage - 1)} aria-label="Página anterior">
                  <ArrowLeft size={18} aria-hidden="true" /> Anterior
                </button>
                <span role="status" className="text-sm">Página {visiblePage + 1} de {pageCount}</span>
                <button type="button" className="button-secondary" disabled={visiblePage === pageCount - 1}
                  onClick={() => setPage(visiblePage + 1)} aria-label="Próxima página">
                  Próxima <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        ) : (
          <p role="status" className="surface p-4">
            {activeQuery ? "Nenhum símbolo encontrado. Tente outra palavra."
              : "Nenhum símbolo nesta área."}
          </p>
        )}
      </section>
    </div>
  );
}
