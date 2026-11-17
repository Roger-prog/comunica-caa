import { useId, useRef, useState } from "react";
import { saveBoardSettings, type PatientBoard } from "../lib/patientBoard";

export function HistoryControls({
  patientId, board, disabled, onSettingsSaved, onDelete,
}: {
  patientId: string;
  board: PatientBoard;
  disabled: boolean;
  onSettingsSaved: () => void;
  onDelete: (before: string | null) => Promise<void>;
}) {
  const titleId = useId();
  const periodId = useId();
  const [period, setPeriod] = useState("30");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const running = useRef(false);
  const clearButton = useRef<HTMLButtonElement>(null);
  const recording = board.settings.historyRecording;
  const unavailable = disabled || busy;

  async function run(action: () => Promise<void>, success: string) {
    if (unavailable || running.current) return;
    running.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ error: false, text: success });
    } catch (error) {
      setFeedback({
        error: true,
        text: error instanceof Error ? error.message : "Não foi possível atualizar o histórico.",
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function toggleRecording() {
    void run(async () => {
      await saveBoardSettings(patientId, { ...board.settings, historyRecording: !recording }, board.settingsVersion);
      onSettingsSaved();
    }, recording ? "O registro de novas atividades foi pausado." : "O registro de atividades foi retomado.");
  }

  function removeRecords() {
    const cutoff = period === "all" ? null : new Date(Date.now() - Number(period) * 86_400_000).toISOString();
    void run(async () => {
      await onDelete(cutoff);
      setConfirming(false);
    }, "Os registros selecionados foram excluídos.");
  }

  return <section className="surface space-y-4 p-5 sm:p-6" aria-labelledby={titleId}>
    <div>
      <h2 id={titleId} className="text-lg font-semibold">Histórico deste perfil</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        O histórico guarda seleções de símbolos e mensagens reproduzidas. Profissionais vinculados podem consultar esses registros.
      </p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="button-secondary" disabled={unavailable} onClick={toggleRecording}>
        {recording ? "Pausar novos registros" : "Retomar registros"}
      </button>
      <span className="text-sm text-stone-600">{recording ? "Registro ativo" : "Registro pausado"}</span>
    </div>
    <fieldset disabled={unavailable || confirming} className="space-y-2 border-t border-stone-200 pt-4">
      <label htmlFor={periodId} className="text-sm font-medium">Registros a excluir</label>
      <div className="flex flex-wrap gap-2">
        <select id={periodId} className="input-field w-auto max-w-full" value={period}
          onChange={(event) => setPeriod(event.target.value)}>
          <option value="30">Com mais de 30 dias</option>
          <option value="90">Com mais de 90 dias</option>
          <option value="all">Todo o histórico</option>
        </select>
        <button ref={clearButton} type="button" className="button-secondary text-red-800" onClick={() => setConfirming(true)}>
          Excluir registros
        </button>
      </div>
    </fieldset>
    {confirming && <div role="group" aria-label="Confirmar exclusão do histórico" className="space-y-3 rounded-xl bg-red-50 p-3">
      <p className="text-sm text-red-900">
        {period === "all" ? "Excluir todo o histórico deste perfil?" : "Excluir os registros com mais de " + period + " dias?"}
        {" "}Essa ação é definitiva.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="button-secondary" disabled={busy} autoFocus onClick={() => {
          setConfirming(false);
          requestAnimationFrame(() => clearButton.current?.focus());
        }}>Cancelar</button>
        <button type="button" className="button-secondary text-red-900" disabled={unavailable} onClick={removeRecords}>
          Confirmar exclusão
        </button>
      </div>
    </div>}
    {busy && <p role="status" className="text-sm text-stone-600">Atualizando histórico…</p>}
    {feedback && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? "text-sm text-red-800" : "text-sm text-stone-700"}>
      {feedback.text}
    </p>}
  </section>;
}
