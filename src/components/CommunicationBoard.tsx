import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  MessageCircle,
  LockKeyhole,
  Search,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { CATEGORIES, PICTOGRAMS, type Pictogram } from "../data/pictograms";
import type { useSpeech } from "../hooks/useSpeech";

interface CommunicationBoardProps {
  onSelect: (pictogram: Pictogram) => void;
  speech: ReturnType<typeof useSpeech>;
  voiceURI: string;
  rate: number;
  largeCards: boolean;
  isChildMode?: boolean;
  onUnlockRequest?: () => void;
}

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function CommunicationBoard({
  onSelect,
  speech,
  voiceURI,
  rate,
  largeCards,
  isChildMode = false,
  onUnlockRequest,
}: CommunicationBoardProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todos");
  const [sentence, setSentence] = useState<Pictogram[]>([]);
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      isChildMode
        ? PICTOGRAMS
        : PICTOGRAMS.filter(
            (item) =>
              (category === "Todos" || item.category === category) &&
              normalize(item.label).includes(normalize(query.trim())),
          ),
    [category, query, isChildMode],
  );
  const sentenceLabels = useMemo(
    () => sentence.map((item) => item.label),
    [sentence],
  );
  const { prefetch, prepareSentence } = speech;

  useEffect(
    () => prefetch(filtered.map((item) => item.label), { voiceURI, rate }),
    [filtered, prefetch, voiceURI, rate],
  );

  useEffect(() => {
    if (!sentenceLabels.length) return;
    return prepareSentence(sentenceLabels, { voiceURI, rate });
  }, [sentenceLabels, prepareSentence, voiceURI, rate]);

  function select(pictogram: Pictogram) {
    // Do not await persistence before speak(): mobile browsers require a user gesture.
    speech.speak(pictogram.label, { voiceURI, rate });
    setSentence((current) => [...current.slice(-11), pictogram]);
    setLastSelected(pictogram.id);
    onSelect(pictogram);
  }

  return (
    <div className={isChildMode ? "space-y-4" : "space-y-6"}>
      <section
        className={
          isChildMode
            ? "surface sticky top-3 z-10 p-3 shadow-sm sm:p-4"
            : "surface p-5 sm:p-6"
        }
        aria-labelledby="sentence-title"
      >
        <div
          className={
            isChildMode
              ? "sr-only"
              : "mb-4 flex flex-wrap items-center justify-between gap-3"
          }
        >
          <div className="flex items-center gap-2 text-[#6c48a0]">
            <MessageCircle size={19} aria-hidden="true" />
            <h2 id="sentence-title" className="text-sm font-semibold">
              O que vamos comunicar?
            </h2>
          </div>
          <span className="text-xs text-stone-500">
            Até 12 símbolos por frase
          </span>
        </div>
        <div className="flex min-h-20 flex-wrap items-center gap-2 rounded-2xl bg-[#faf8fc] p-3">
          {sentence.length ? (
            sentence.map((item, index) => (
              <span
                key={`${item.id}-${index}`}
                className="inline-flex items-center gap-2 rounded-xl border border-[#e7dfef] bg-white px-3 py-2 text-sm font-medium"
              >
                <span
                  aria-hidden="true"
                  className={isChildMode ? "text-3xl" : "text-2xl"}
                >
                  {item.symbol}
                </span>
                {item.label}
              </span>
            ))
          ) : (
            <p className="px-1 text-sm text-stone-500">
              {isChildMode
                ? "Toque em um símbolo."
                : "Toque em um símbolo para dar voz ao que você quer dizer."}
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="button-primary min-h-12"
            disabled={!sentence.length || !speech.supported}
            onClick={() =>
              speech.speak(sentenceLabels.join(" "), {
                voiceURI,
                rate,
                segments: sentenceLabels,
              })
            }
          >
            <Volume2 size={18} aria-hidden="true" /> Ouvir frase
          </button>
          <button
            type="button"
            className="button-secondary min-h-12"
            disabled={!sentence.length}
            onClick={() => {
              speech.stop();
              setSentence([]);
              setLastSelected(null);
            }}
          >
            <X size={17} aria-hidden="true" /> Limpar
          </button>
          {speech.speaking && (
            <button
              type="button"
              className="button-secondary min-h-12"
              onClick={speech.stop}
            >
              <Square size={15} aria-hidden="true" /> Parar áudio
            </button>
          )}
          {speech.needsPlaybackGesture && (
            <button
              type="button"
              className="button-primary min-h-12"
              onClick={speech.retryPlayback}
            >
              <Volume2 size={18} aria-hidden="true" />
              Ouvir áudio pronto
            </button>
          )}
          {isChildMode && (
            <button
              type="button"
              onClick={onUnlockRequest}
              aria-label="Desbloquear modo criança"
              className="ml-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-stone-500 hover:bg-stone-100 hover:text-brand-600"
            >
              <LockKeyhole size={20} aria-hidden="true" />
            </button>
          )}
        </div>
        {!speech.supported && (
          <p className="mt-3 text-sm text-stone-600">
            Este navegador não oferece leitura em voz alta. Os símbolos e o
            texto continuam disponíveis.
          </p>
        )}
        {speech.error && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800"
          >
            {speech.error}
          </p>
        )}
      </section>

      <section
        aria-labelledby={isChildMode ? undefined : "symbols-title"}
        aria-label={isChildMode ? "Símbolos de comunicação" : undefined}
      >
        {!isChildMode && (
          <>
            <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h2
                  id="symbols-title"
                  className="text-xl font-semibold tracking-tight"
                >
                  Sua prancha, suas palavras
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  Escolha um símbolo. Cada expressão importa.
                </p>
              </div>
              <div className="relative sm:w-64">
                <Search
                  size={18}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400"
                  aria-hidden="true"
                />
                <label htmlFor="symbol-search" className="sr-only">
                  Buscar símbolo
                </label>
                <input
                  id="symbol-search"
                  type="search"
                  className="input-field min-h-12 pl-11"
                  placeholder="Buscar símbolo…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            <div
              className="mb-5 flex flex-wrap gap-2"
              aria-label="Filtrar símbolos por categoria"
            >
              {["Todos", ...CATEGORIES].map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                  className={`min-h-12 rounded-full border px-4 text-sm font-medium transition-colors ${category === item ? "border-[#6c48a0] bg-[#6c48a0] text-white" : "border-[#e7e1eb] bg-white text-stone-600 hover:border-[#6c48a0] hover:text-[#6c48a0]"}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </>
        )}
        <div
          className={`grid gap-3 sm:gap-4 ${largeCards ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"}`}
        >
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Falar ${item.label}`}
              aria-pressed={lastSelected === item.id}
              onClick={() => select(item)}
              className={`group relative flex min-h-40 flex-col items-center justify-center gap-3 rounded-3xl border-2 bg-white p-4 transition duration-150 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:bg-purple-200 active:scale-95 active:duration-0 motion-reduce:transform-none motion-reduce:active:scale-100 ${largeCards ? "sm:min-h-52" : ""} ${lastSelected === item.id ? "border-[#6c48a0] shadow-sm" : "border-transparent hover:border-[#d7c7e7]"}`}
            >
              <span
                className={`${largeCards ? "h-24 w-24 text-6xl" : "h-20 w-20 text-5xl"} flex items-center justify-center rounded-2xl`}
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              >
                {item.symbol}
              </span>
              <span
                className={`${largeCards ? "text-lg" : "text-base"} font-semibold text-[#2e2937]`}
              >
                {item.label}
              </span>
              {!isChildMode && (
                <Volume2
                  size={13}
                  aria-hidden="true"
                  className="absolute right-3 top-3 text-[#b5a5c4]"
                />
              )}
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="surface px-6 py-12 text-center">
            <Search
              size={28}
              aria-hidden="true"
              className="mx-auto mb-3 text-stone-400"
            />
            <h3 className="font-semibold">Nenhum símbolo encontrado</h3>
            <p className="mt-2 text-sm text-stone-500">
              Tente outra palavra ou escolha uma categoria diferente.
            </p>
            <button
              type="button"
              className="button-secondary mx-auto mt-4 min-h-12"
              onClick={() => {
                setQuery("");
                setCategory("Todos");
              }}
            >
              Ver todos os símbolos <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
