import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { CATEGORY_OPTIONS, DEFAULT_HOME_SYMBOL_IDS, getCategoryLabel } from "../data/pictograms";
import { deleteCustomSymbol, saveBoardSettings, saveCustomSymbol, symbolDraft,
  type CustomSymbol, type PatientBoard, type SymbolDraft } from "../lib/patientBoard";
import { ArasaacImage, ArasaacPicker } from "./ArasaacPicker";
import { PatientPhoto } from "./PatientPhoto";
import { PhotoEditor } from "./PhotoEditor";

function PhotoPreview({ photo }: { photo: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const resource = URL.createObjectURL(photo);
    setUrl(resource);
    return () => URL.revokeObjectURL(resource);
  }, [photo]);
  return url && <img src={url} alt="Prévia da foto selecionada" className="size-20 rounded-xl object-cover" />;
}

function SymbolImage({ symbol }: { symbol: CustomSymbol }) {
  const fallback = <ImageIcon size={24} className="text-stone-500" aria-hidden="true" />;
  if (symbol.image_path) return <PatientPhoto path={symbol.image_path} alt="" fallback={fallback} className="size-12 rounded-lg object-cover" />;
  if (symbol.arasaac_id) return <ArasaacImage id={symbol.arasaac_id} alt="" fallback={fallback} className="size-12 object-contain" />;
  return fallback;
}

function SymbolForm({ data, patientId, patientName, symbol, onCancel, onSaved }: {
  data: PatientBoard;
  patientId: string;
  patientName: string;
  symbol: CustomSymbol | null;
  onCancel: () => void;
  onSaved: (message: string, warning: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => symbolDraft(symbol, CATEGORY_OPTIONS[0]?.id ?? ""));
  const [pending, setPending] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [home, setHome] = useState<boolean | null>(null);
  const [showArasaac, setShowArasaac] = useState(false);
  const didSubmit = useRef(false);
  const labelId = useId();
  const speechId = useId();

  function set<K extends keyof SymbolDraft>(key: K, value: SymbolDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (didSubmit.current || photoPending) return;
    didSubmit.current = true;
    setError(null);
    setPending(true);
    try {
      const latest = await saveCustomSymbol(patientId, symbol, draft);
      const id = latest.symbol.id;
      const homeIds = data.settings.homeSymbols ?? DEFAULT_HOME_SYMBOL_IDS;
      let shortcutFailed = false;
      const favoriteChanged = favorite !== null && favorite !== data.settings.favorites.includes(id);
      const homeChanged = home !== null && home !== homeIds.includes(id);
      if (favoriteChanged || homeChanged) {
        try {
          await saveBoardSettings(patientId, {
            ...data.settings,
            favorites: !favoriteChanged ? data.settings.favorites : favorite ? [...data.settings.favorites, id] : data.settings.favorites.filter((item) => item !== id),
            homeSymbols: !homeChanged ? data.settings.homeSymbols : home ? [...homeIds, id] : homeIds.filter((item) => item !== id),
          }, data.settingsVersion);
        } catch {
          shortcutFailed = true;
        }
      }
      let message = symbol ? "Símbolo atualizado." : "Símbolo criado.";
      if (shortcutFailed) message += " Os atalhos não foram salvos. Atualize-os na aba Preferências.";
      if (latest.cleanupPending) message += " A remoção da foto anterior ficou pendente.";
      onSaved(message, shortcutFailed || latest.cleanupPending);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível salvar o símbolo.");
    } finally {
      setPending(false);
      didSubmit.current = false;
    }
  }

  const fallback = <ImageIcon aria-hidden="true" size={30} className="text-stone-500" />;
  return <form className="space-y-4 rounded-2xl border border-brand-100 bg-brand-50/40 p-4" onSubmit={(event) => void submit(event)}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{symbol ? "Editar símbolo" : "Criar símbolo"}</h3>
      <p className="rounded-full bg-white px-3 py-2 text-sm">Paciente: <strong>{patientName}</strong></p>
    </div>
    <fieldset disabled={pending} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={labelId} className="text-sm font-medium">Nome do símbolo</label>
          <input id={labelId} className="input-field" autoFocus required maxLength={80} value={draft.label} onChange={(event) => set("label", event.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor={speechId} className="text-sm font-medium">Frase falada</label>
          <input id={speechId} className="input-field" maxLength={150} placeholder="Usa o nome se ficar em branco" value={draft.speechText} onChange={(event) => set("speechText", event.target.value)} />
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Imagem do símbolo (obrigatória)</h4>
        <PhotoEditor disabled={pending} setBusy={setPhotoPending} onPhoto={(photo) => {
          setDraft((current) => ({ ...current, photo, photoAuthorized: false, arasaacId: null, imagePath: null }));
          setShowArasaac(false);
        }} />
        {draft.photo && <label className="flex items-start gap-3 rounded-lg bg-white p-3 text-sm">
          <input type="checkbox" className="mt-1 size-4 shrink-0 accent-brand-600" required checked={draft.photoAuthorized} onChange={(event) => set("photoAuthorized", event.target.checked)} />
          Confirmo que tenho autorização para usar esta imagem e compartilhá-la com os responsáveis e profissionais vinculados a este paciente.
        </label>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button-secondary" disabled={photoPending} aria-expanded={showArasaac} onClick={() => setShowArasaac((value) => !value)}>{showArasaac ? "Fechar galeria" : "Escolher pictograma ARASAAC"}</button>
          {(draft.photo || draft.imagePath || draft.arasaacId) && <button type="button" className="button-secondary" disabled={photoPending} onClick={() => setDraft((current) => ({ ...current, photo: null, imagePath: null, arasaacId: null, photoAuthorized: false }))}>Remover imagem</button>}
        </div>
        {showArasaac && <ArasaacPicker disabled={pending || photoPending} selectedId={draft.arasaacId} onSelect={(id) => setDraft((current) => ({ ...current, arasaacId: id, photo: null, imagePath: null, photoAuthorized: false }))} />}
      </div>

      <fieldset className="space-y-2 rounded-2xl border border-stone-200 bg-white p-3">
        <legend className="px-1 text-sm font-semibold">Categorias do símbolo</legend>
        <p className="text-xs text-stone-600">Escolha até oito categorias.</p>
        <div className="grid grid-cols-2 gap-x-2 sm:grid-cols-3">
          {CATEGORY_OPTIONS.map(({ id, label }) => <label key={id} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 shrink-0 accent-brand-600" checked={draft.categories.includes(id)} disabled={draft.categories.length >= 8 && !draft.categories.includes(id)}
              onChange={(event) => set("categories", event.target.checked ? [...draft.categories, id] : draft.categories.filter((category) => category !== id))} /> {label}
          </label>)}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-x-5">
        <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={favorite ?? (!!symbol && data.settings.favorites.includes(symbol.id))} disabled={data.settings.favorites.length >= 256 && (!symbol || !data.settings.favorites.includes(symbol.id))} onChange={(event) => setFavorite(event.target.checked)} /> Adicionar aos favoritos</label>
        <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={home ?? (!!symbol && (data.settings.homeSymbols ?? DEFAULT_HOME_SYMBOL_IDS).includes(symbol.id))} disabled={(data.settings.homeSymbols ?? DEFAULT_HOME_SYMBOL_IDS).length >= 36 && (!symbol || !(data.settings.homeSymbols ?? DEFAULT_HOME_SYMBOL_IDS).includes(symbol.id))} onChange={(event) => setHome(event.target.checked)} /> Mostrar no Início</label>
      </div>
    </fieldset>

    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-3">
      {draft.photo ? <PhotoPreview photo={draft.photo} />
        : draft.imagePath ? <PatientPhoto path={draft.imagePath} alt="" fallback={fallback} className="size-20 rounded-xl object-cover" />
          : draft.arasaacId ? <ArasaacImage id={draft.arasaacId} alt="" fallback={fallback} className="size-20 object-contain" /> : fallback}
      <div className="min-w-0 break-words">
        <p className="text-xs text-stone-600">Prévia · {draft.arasaacId ? "Pictograma ARASAAC" : "Personalizado"}</p>
        <p className="font-semibold">{draft.label.trim() || "Nome do símbolo"}</p>
        {draft.speechText && <p className="text-sm text-stone-600">{draft.speechText}</p>}
      </div>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" className="button-primary" disabled={pending || photoPending}>{pending ? "Salvando…" : "Salvar símbolo"}</button>
      <button type="button" className="button-secondary" onClick={onCancel} disabled={pending}>Cancelar</button>
    </div>
  </form>;
}

export function BoardSymbolManager({ data, patientId, patientName, userId, canDeleteAny, onChange }: {
  data: PatientBoard; patientId: string; patientName: string; userId: string; canDeleteAny: boolean; onChange: () => void;
}) {
  const [editing, setEditing] = useState<{ symbol: CustomSymbol | null } | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; warning: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const list = data.symbols.filter((symbol) => symbol.hidden === showHidden);
  const pages = Math.max(1, Math.ceil(list.length / 10));
  const currentPage = Math.min(page, pages - 1);

  function saved(message: string, warning: boolean) {
    setEditing(null);
    setFeedback({ message, warning });
    onChange();
  }

  async function changeSymbol(symbol: CustomSymbol, remove: boolean) {
    if (action) return;
    setAction(symbol.id);
    setFeedback(null);
    try {
      const updated = remove ? await deleteCustomSymbol(patientId, symbol)
        : await saveCustomSymbol(patientId, symbol, { ...symbolDraft(symbol, ""), hidden: !symbol.hidden });
      setConfirm(null);
      const text = remove ? "Símbolo excluído." : symbol.hidden ? "Símbolo restaurado." : "Símbolo ocultado.";
      saved(`${text}${updated.cleanupPending ? " A remoção da foto ficou pendente." : ""}`, updated.cleanupPending);
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Não foi possível atualizar o símbolo.", warning: true });
    } finally {
      setAction(null);
    }
  }

  if (editing) return <SymbolForm key={editing.symbol?.id ?? "new"} data={data} patientId={patientId} patientName={patientName} symbol={editing.symbol} onSaved={saved} onCancel={() => setEditing(null)} />;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button className="button-primary" type="button" onClick={() => { setFeedback(null); setConfirm(null); setEditing({ symbol: null }); }} disabled={data.symbols.length >= 250 || !!action}><Plus size={18} aria-hidden="true" /> Criar símbolo</button>
      <button className="button-secondary" type="button" aria-pressed={showHidden} onClick={() => { setShowHidden((value) => !value); setPage(0); setConfirm(null); }}>{showHidden ? "Ver símbolos ativos" : "Ver símbolos ocultos"}</button>
    </div>
    {data.symbols.length >= 250 && <p className="text-sm text-stone-600">O limite de 250 símbolos personalizados foi atingido.</p>}
    {feedback && <p role={feedback.warning ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${feedback.warning ? "bg-amber-50 text-amber-950" : "bg-emerald-50 text-emerald-800"}`}>{feedback.message}</p>}
    {list.length ? <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200">
      {list.slice(currentPage * 10, currentPage * 10 + 10).map((symbol) => <li key={symbol.id} className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <SymbolImage symbol={symbol} />
          <div className="min-w-32 flex-1 break-words">
            <p className="font-semibold">{symbol.label}</p>
            <p className="text-xs text-stone-600">{symbol.arasaac_id ? "ARASAAC" : "Personalizado"} · {symbol.categories.map(getCategoryLabel).join(", ")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="button-secondary" aria-label={`Editar ${symbol.label}`} disabled={!!action} onClick={() => setEditing({ symbol })}><Pencil size={16} aria-hidden="true" /> Editar</button>
            <button type="button" className="button-secondary" aria-label={`${symbol.hidden ? "Restaurar" : "Ocultar"} ${symbol.label}`} disabled={!!action} onClick={() => void changeSymbol(symbol, false)}>
              {symbol.hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />} {symbol.hidden ? "Restaurar" : "Ocultar"}
            </button>
            {(canDeleteAny || symbol.created_by === userId) && <button type="button" className="button-secondary" aria-label={`Excluir ${symbol.label}`} aria-expanded={confirm === symbol.id} disabled={!!action} onClick={() => setConfirm(symbol.id)}><Trash2 size={16} aria-hidden="true" /> Excluir</button>}
          </div>
        </div>
        {confirm === symbol.id && <div className="mt-3 space-y-2 rounded-xl bg-red-50 p-3" role="group" aria-label={`Confirmar exclusão de ${symbol.label}`}>
          <p className="text-sm text-red-900">Excluir permanentemente o símbolo {symbol.label}?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="button-primary !bg-red-700 hover:!bg-red-800" disabled={!!action} onClick={() => void changeSymbol(symbol, true)}>{action ? "Excluindo…" : "Confirmar exclusão"}</button>
            <button type="button" className="button-secondary" disabled={!!action} onClick={() => setConfirm(null)}>Cancelar</button>
          </div>
        </div>}
      </li>)}
    </ul> : <p className="text-sm text-stone-600">{showHidden ? "Nenhum símbolo oculto." : "Nenhum símbolo personalizado neste perfil."}</p>}
    {pages > 1 && <div className="flex flex-wrap items-center gap-2" aria-label="Páginas de símbolos personalizados">
      <button type="button" className="button-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
      <span className="text-sm text-stone-600">Página {currentPage + 1} de {pages}</span>
      <button type="button" className="button-secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Próxima</button>
    </div>}
  </div>;
}
