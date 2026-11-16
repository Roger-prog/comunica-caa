import { useId, useRef, useState } from "react";
import { BookOpen, Plus, Settings2, Shapes } from "lucide-react";
import { retryBoardPhotoCleanup, type PatientBoard } from "../lib/patientBoard";
import { BoardSymbolManager } from "./BoardSymbolManager";
import { BoardSettingsManager } from "./BoardSettingsManager";
import { BoardCatalogManager } from "./BoardCatalogManager";

const sections = [
  { id: "symbols", label: "Símbolos", icon: Shapes },
  { id: "settings", label: "Preferências", icon: Settings2 },
  { id: "catalog", label: "Revisar catálogo", icon: BookOpen },
] as const;

type BoardManagerProps = {
  patientId: string;
  patientName: string;
  userId: string;
  data: PatientBoard | null;
  onChange: () => void;
  canDeleteAny?: boolean;
};

export function BoardManager(props: BoardManagerProps) {
  return <PatientBoardManager key={props.patientId} {...props} />;
}

function PatientBoardManager({ patientId, patientName, userId, data, onChange, canDeleteAny = false }: BoardManagerProps) {
  const headingId = useId();
  const [active, setActive] = useState<(typeof sections)[number]["id"]>("symbols");
  const [settingsVisited, setSettingsVisited] = useState(false);
  const [symbolEntry, setSymbolEntry] = useState<"active" | "hidden" | "create">("active");
  const [cleaning, setCleaning] = useState(false);
  const [cleanup, setCleanup] = useState<{ message: string; error: boolean } | null>(null);
  const symbolsTab = useRef<HTMLButtonElement>(null);

  function openSymbols(entry: typeof symbolEntry) {
    setSymbolEntry(entry);
    setActive("symbols");
    if (entry === "hidden") symbolsTab.current?.focus();
  }

  function openSection(section: typeof active) {
    if (section === active) return;
    if (section === "settings") setSettingsVisited(true);
    if (section === "symbols") setSymbolEntry("active");
    setActive(section);
  }

  async function clean() {
    if (cleaning) return;
    setCleaning(true);
    setCleanup(null);
    try {
      await retryBoardPhotoCleanup(patientId);
      setCleanup({ message: "Fotos antigas pendentes verificadas.", error: false });
    } catch (error) {
      setCleanup({ message: error instanceof Error ? error.message : "Não foi possível verificar as fotos pendentes.", error: true });
    } finally { setCleaning(false); }
  }

  return <section className="surface space-y-5 p-4 sm:p-6" aria-labelledby={headingId}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 id={headingId} className="text-lg font-semibold">Personalizar prancha</h2>
        <p className="mt-1 break-words text-sm text-stone-600">Paciente: {patientName}</p>
      </div>
      {data && active !== "symbols" && <button type="button" className="button-primary" disabled={data.symbols.length >= 250} onClick={() => openSymbols("create")}>
        <Plus size={18} aria-hidden="true" /> Criar símbolo
      </button>}
    </div>
    {data ? <>
      <div role="group" aria-label="Ferramentas da prancha" className="flex flex-wrap gap-2">
        {sections.map(({ id, label, icon: Icon }) => <button type="button" key={id} ref={id === "symbols" ? symbolsTab : undefined} aria-pressed={active === id} className={active === id ? "button-primary" : "button-secondary"} onClick={() => openSection(id)}><Icon size={17} aria-hidden="true" /> {label}</button>)}
      </div>
      {active === "symbols" && <BoardSymbolManager patientId={patientId} patientName={patientName} userId={userId} canDeleteAny={canDeleteAny} data={data} onChange={onChange} initialView={symbolEntry} />}
      {settingsVisited && <div hidden={active !== "settings"}>
        <BoardSettingsManager patientId={patientId} data={data} onChange={onChange} active={active === "settings"} onShowHiddenSymbols={() => openSymbols("hidden")} />
      </div>}
      {active === "catalog" && <BoardCatalogManager patientId={patientId} patientName={patientName} data={data} onChange={onChange} />}
      {active === "symbols" && <div className="space-y-2 border-t border-stone-200 pt-3">
        <button type="button" className="min-h-11 rounded-lg px-2 text-sm font-medium text-brand-700 hover:underline" disabled={cleaning} onClick={() => void clean()}>{cleaning ? "Verificando fotos…" : "Verificar remoções de fotos pendentes"}</button>
        {cleanup && <p role={cleanup.error ? "alert" : "status"} className={cleanup.error ? "text-sm text-red-800" : "text-sm text-stone-600"}>{cleanup.message}</p>}
      </div>}
    </> : <p role="status" className="text-sm text-stone-600">Carregando a personalização da prancha…</p>}
  </section>;
}
