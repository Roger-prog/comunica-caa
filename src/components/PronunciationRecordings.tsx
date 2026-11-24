import { useEffect, useId, useState } from "react";
import { activityDateTime } from "../lib/activityEvents";
import {
  deleteRecording, fetchRecordingAudio, getRecordingSettings, listRecordingNotes, listRecordings,
  loadRecordingAccess, saveRecordingAccess, saveRecordingNote, setRetention,
  type Recording, type RecordingAccess, type RecordingNote, type RecordingSettings,
} from "../lib/pronunciation";
import { PronunciationRecorder, useClipUrl } from "./PronunciationRecorder";

function message(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir esta ação.";
}

function RecordingReview({ recording }: { recording: Recording }) {
  const [audio, setAudio] = useState<Blob>();
  const [notes, setNotes] = useState<RecordingNote[]>();
  const [observation, setObservation] = useState("");
  const [error, setError] = useState("");
  const [playbackError, setPlaybackError] = useState("");
  const [notesError, setNotesError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const url = useClipUrl(audio);

  useEffect(() => {
    const controller = new AbortController();
    void fetchRecordingAudio(recording.id, controller.signal).then((clip) => {
      if (!controller.signal.aborted) setAudio(clip);
    }).catch((problem: unknown) => {
      if (!controller.signal.aborted) setPlaybackError(message(problem));
    });
    return () => controller.abort();
  }, [recording.id]);

  useEffect(() => {
    const controller = new AbortController();
    void listRecordingNotes(recording.id, controller.signal).then((items) => {
      if (!controller.signal.aborted) {
        setNotes(items);
        setNotesError("");
        setObservation(items.find((note) => note.own)?.observation ?? "");
      }
    }).catch((problem: unknown) => {
      if (!controller.signal.aborted) setNotesError(message(problem));
    });
    return () => controller.abort();
  }, [recording.id, revision]);

  async function submit() {
    if (saving || !observation.trim()) return;
    setSaving(true);
    setError("");
    try {
      await saveRecordingNote(recording.id, observation);
      setNotes(undefined);
      setRevision((value) => value + 1);
    } catch (problem) {
      setError(message(problem));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-stone-200 pt-4">
      {playbackError ? <p role="alert" className="text-sm text-red-800 dark:text-red-300">{playbackError}</p>
        : !url ? <p role="status" className="text-sm">Carregando áudio…</p>
        : (
          <div className="space-y-2">
            <audio className="max-w-full" controls preload="metadata" src={url}
              aria-label={`Gravação de ${recording.practice}`}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
              onError={() => setPlaybackError("Não foi possível reproduzir este formato de áudio.")} />
            {playing && <p role="status" className="text-sm">Reproduzindo.</p>}
          </div>
        )}
      <h3 className="font-semibold">Observações profissionais</h3>
      {notesError ? <p role="alert" className="text-sm text-red-800 dark:text-red-300">{notesError}</p>
        : !notes ? <p role="status" className="text-sm">Carregando observações…</p>
        : notes.length ? (
          <ul className="space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="rounded-xl border border-stone-200 p-3">
                <p className="text-sm font-semibold">{note.author_name}</p>
                <time className="text-xs text-stone-600" dateTime={note.updated_at}>
                  {activityDateTime.format(new Date(note.updated_at))}
                </time>
                <p className="mt-1 whitespace-pre-wrap break-words">{note.observation}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-stone-600">Nenhuma observação registrada.</p>}
      {recording.can_observe && notes && (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="grid gap-2 text-sm font-medium">
            Sua observação profissional
            <textarea className="input-field" rows={3} required maxLength={2000} value={observation} disabled={saving}
              onChange={(event) => setObservation(event.target.value)} />
          </label>
          <button type="submit" className="button-secondary" disabled={saving || !observation.trim()}>
            {saving ? "Salvando…" : "Salvar observação"}
          </button>
          {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
        </form>
      )}
    </div>
  );
}

function RecordingHistory({ patientId, revision }: { patientId: string; revision: number }) {
  const [rows, setRows] = useState<Recording[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [request, setRequest] = useState<{ cursor?: Recording; revision: number }>();
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const cursor = request?.revision === revision ? request.cursor : undefined;
    setLoading(true);
    setError("");
    void listRecordings(patientId, cursor, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setRows((previous) => cursor ? [...previous, ...next.items] : next.items);
      setHasOlder(next.hasOlder);
      if (!cursor) setPlayingId("");
    }).catch((problem: unknown) => {
      if (!controller.signal.aborted) {
        setError(message(problem));
        if (!cursor) {
          setRows([]);
          setHasOlder(false);
          setPlayingId("");
        }
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [patientId, revision, request]);

  async function remove(id: string) {
    setDeleting(true);
    setError("");
    setFeedback("");
    try {
      await deleteRecording(id);
      setConfirmDelete("");
      setFeedback("Gravação excluída.");
      setRequest({ revision });
    } catch (problem) {
      setError(message(problem));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Histórico de gravações</h3>
      {loading && <p role="status" className="text-sm">Carregando gravações…</p>}
      {error && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {error} <button type="button" className="font-semibold underline" onClick={() => setRequest({ revision })}>Atualizar lista</button>
        </p>
      )}
      {feedback && <p role="status" className="text-sm">{feedback}</p>}
      {!loading && !error && !rows.length && <p className="text-sm text-stone-600">Nenhuma gravação neste perfil.</p>}
      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((recording) => (
            <li className="rounded-xl border border-stone-200 p-3 sm:p-4" key={recording.id}>
              <p className="font-semibold break-words">{recording.practice}</p>
              <time className="text-sm text-stone-600" dateTime={recording.created_at}>
                {activityDateTime.format(new Date(recording.created_at))}
              </time>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="button-secondary" aria-expanded={playingId === recording.id}
                  onClick={() => setPlayingId((current) => current === recording.id ? "" : recording.id)}>
                  {playingId === recording.id ? "Fechar áudio e observações" : "Abrir áudio e observações"}
                </button>
                {recording.can_delete && <button type="button" className="button-secondary"
                  disabled={deleting} onClick={() => setConfirmDelete(recording.id)}>Excluir gravação</button>}
              </div>
              {confirmDelete === recording.id && (
                <div className="mt-3 space-y-2 rounded-xl bg-red-50 p-3" role="group" aria-label="Confirmar exclusão da gravação">
                  <p className="text-sm text-red-900">Excluir o áudio e suas observações?</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="button-secondary" disabled={deleting} onClick={() => setConfirmDelete("")}>Cancelar</button>
                    <button type="button" className="button-secondary" disabled={deleting}
                      onClick={() => void remove(recording.id)}>Confirmar exclusão</button>
                  </div>
                </div>
              )}
              {playingId === recording.id && <RecordingReview recording={recording} />}
            </li>
          ))}
        </ul>
      )}
      {hasOlder && <button type="button" className="button-secondary" disabled={loading}
        onClick={() => setRequest({ cursor: rows.at(-1), revision })}>Carregar gravações anteriores</button>}
    </div>
  );
}

function RecordingPermissions({
  patientId, retentionDays, onRetentionSaved,
}: {
  patientId: string; retentionDays: number; onRetentionSaved: (days: number) => void;
}) {
  const [days, setDays] = useState(retentionDays);
  const [access, setAccess] = useState<RecordingAccess[]>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void loadRecordingAccess(patientId, controller.signal).then((members) => {
      if (!controller.signal.aborted) setAccess(members);
    }).catch((problem: unknown) => {
      if (!controller.signal.aborted) setError(message(problem));
    });
    return () => controller.abort();
  }, [patientId]);

  async function update(action: () => Promise<void>) {
    if (saving) return;
    setError("");
    setFeedback("");
    setSaving(true);
    try {
      await action();
      setFeedback("Ajustes de gravação salvos.");
    } catch (problem) {
      setError(message(problem));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="rounded-xl border border-stone-200 p-3">
      <summary className="cursor-pointer py-2 font-semibold">Ajustes de gravação</summary>
      <form className="my-3 space-y-3" onSubmit={(event) => {
        event.preventDefault();
        void update(async () => { await setRetention(patientId, days); onRetentionSaved(days); });
      }}>
        <label className="grid max-w-xs gap-2 text-sm font-medium">
          Prazo de retenção das gravações
          <select className="input-field" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {[30, 90, 180, 365].map((value) => <option key={value} value={value}>{value} dias</option>)}
          </select>
        </label>
        <p className="text-sm text-stone-600">
          Reduzir o prazo exclui as gravações vencidas e suas observações. Aumentar o prazo vale para as próximas gravações.
        </p>
        <button type="submit" className="button-secondary" disabled={saving || days === retentionDays}>Salvar prazo</button>
      </form>
      <h3 className="font-semibold">Acesso de profissionais vinculados</h3>
      {access?.length ? (
        <ul className="mt-3 space-y-3">
          {access.map((member) => (
            <li key={member.professional_id}>
              <label className="grid max-w-sm gap-2 text-sm font-medium">
                {member.professional_name}
                <select className="input-field" disabled={saving}
                  value={member.can_observe ? "observe" : member.can_listen ? "listen" : "none"}
                  onChange={(event) => {
                    const permission = event.target.value;
                    const next = { ...member, can_listen: permission !== "none", can_observe: permission === "observe" };
                    void update(async () => {
                      await saveRecordingAccess(patientId, next);
                      setAccess((current) => current?.map((item) => item.professional_id === next.professional_id ? next : item));
                    });
                  }}>
                  <option value="none">Sem acesso às gravações</option>
                  <option value="listen">Ouvir gravações e consultar observações</option>
                  <option value="observe">Ouvir e registrar observações</option>
                </select>
              </label>
            </li>
          ))}
        </ul>
      ) : access && <p className="mt-2 text-sm text-stone-600">Nenhum profissional com vínculo aprovado.</p>}
      {error && <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>}
      {feedback && <p role="status" className="text-sm">{feedback}</p>}
    </details>
  );
}

export function PronunciationRecordings({
  patientId, preview = false,
}: { patientId?: string; preview?: boolean; suggestions?: string[] }) {
  const titleId = useId();
  const [settings, setSettings] = useState<RecordingSettings>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    if (!patientId || preview) return;
    const controller = new AbortController();
    void getRecordingSettings(patientId, controller.signal).then((data) => {
      if (!controller.signal.aborted) setSettings(data);
    }).catch((problem: unknown) => {
      if (!controller.signal.aborted) setError(message(problem));
    });
    return () => controller.abort();
  }, [patientId, preview, retry]);

  return (
    <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby={titleId}>
      <h2 id={titleId} className="text-xl font-semibold">Escuta da pronúncia</h2>
      <p className="text-sm text-stone-700">
        {preview
          ? "Grave uma palavra para escutar e analisar a pronúncia. O áudio fica neste dispositivo até você sair desta tela."
          : "Grave uma palavra para escutar e analisar a pronúncia. Você pode escutar antes de salvar; gravações salvas ficam privadas neste perfil."}
      </p>
      {preview ? <PronunciationRecorder />
        : !patientId ? <p className="text-sm text-stone-600">Selecione um perfil para consultar as gravações.</p>
        : error ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-red-800 dark:text-red-300">{error}</p>
            <button type="button" className="button-secondary" onClick={() => {
              setError("");
              setRetry((value) => value + 1);
            }}>Tentar novamente</button>
          </div>
        ) : !settings ? <p role="status" className="text-sm">Carregando ajustes de gravação…</p>
        : !settings.can_read ? <p className="text-sm text-stone-600">O responsável titular pode autorizar o acesso às gravações.</p>
        : (
          <>
            {settings.can_record && (
              <PronunciationRecorder patientId={patientId} retentionDays={settings.retention_days}
                onSaved={refresh} />
            )}
            {settings.can_manage && settings.retention_days !== null && (
              <RecordingPermissions patientId={patientId} retentionDays={settings.retention_days}
                onRetentionSaved={(days) => {
                  setSettings({ ...settings, retention_days: days });
                  refresh();
                }} />
            )}
            <RecordingHistory patientId={patientId} revision={revision} />
          </>
        )}
    </section>
  );
}
