import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ClipboardList,
  Download,
  Link2,
  LoaderCircle,
  RefreshCw,
  Users,
} from "lucide-react";
import {
  todayInSaoPaulo,
  useProfessionalDashboard,
} from "../hooks/useProfessionalDashboard";
import { downloadPatientReport } from "../lib/patientReport";
import { ProfessionalError } from "../lib/professional";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});
const PAGE_SIZE = 20;

export function ProfessionalDashboard({
  userId,
  preview,
}: {
  userId: string | null;
  preview: boolean;
}) {
  const dashboard = useProfessionalDashboard(userId, preview);
  const [code, setCode] = useState("");
  const [page, setPage] = useState(0);
  const [exportState, setExportState] = useState<{
    key: string;
    pending: boolean;
    error: string | null;
    success: boolean;
  }>({ key: "", pending: false, error: null, success: false });
  const exportFlight = useRef<{
    key: string;
    controller: AbortController;
  } | null>(null);
  const currentContext = useRef(dashboard.contextKey);
  currentContext.current = dashboard.contextKey;
  const codeId = useId();
  const descriptionId = useId();
  const fromId = useId();
  const toId = useId();
  const pendingExport =
    exportState.key === dashboard.contextKey && exportState.pending;
  const exportError =
    exportState.key === dashboard.contextKey ? exportState.error : null;
  const exportSuccess =
    exportState.key === dashboard.contextKey && exportState.success;
  const pages = Math.max(1, Math.ceil(dashboard.events.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pages - 1);
  const rows = dashboard.events.slice(
    visiblePage * PAGE_SIZE,
    (visiblePage + 1) * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(0);
    const context = dashboard.contextKey;
    return () => {
      if (exportFlight.current?.key === context) {
        exportFlight.current.controller.abort();
        exportFlight.current = null;
      }
    };
  }, [dashboard.contextKey]);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await dashboard.redeem(code)) setCode("");
  }

  async function exportReport() {
    const key = dashboard.contextKey;
    if (
      !dashboard.selectedPatient ||
      dashboard.eventsLoading ||
      dashboard.eventsError ||
      dashboard.periodError ||
      dashboard.loading ||
      exportFlight.current?.key === key
    )
      return;
    exportFlight.current?.controller.abort();
    const controller = new AbortController();
    exportFlight.current = { key, controller };
    setExportState({ key, pending: true, error: null, success: false });
    try {
      // Recheck access and reload the full period immediately before export.
      const report = await dashboard.reportData(controller.signal);
      if (controller.signal.aborted || currentContext.current !== key) return;
      await downloadPatientReport(report, { signal: controller.signal });
      if (!controller.signal.aborted && currentContext.current === key)
        setExportState({ key, pending: false, error: null, success: true });
    } catch (error) {
      if (!controller.signal.aborted && currentContext.current === key)
        setExportState({
          key,
          pending: false,
          error:
            error instanceof ProfessionalError
              ? error.message
              : "Não foi possível exportar o relatório. Tente novamente.",
          success: false,
        });
    } finally {
      if (exportFlight.current?.controller === controller)
        exportFlight.current = null;
    }
  }

  return (
    <div className="space-y-6">
      <section
        className="surface p-5 sm:p-6"
        aria-labelledby="professional-invite-title"
      >
        <div className="mb-4 flex items-center gap-3">
          <Link2 size={21} className="text-brand-600" aria-hidden="true" />
          <div>
            <h2
              id="professional-invite-title"
              className="text-lg font-semibold"
            >
              Vincular paciente
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-stone-600">
              Informe o código de seis dígitos enviado pelo responsável. O
              convite é válido por 10 minutos e pode ser utilizado uma vez.
            </p>
          </div>
        </div>
        <form
          onSubmit={redeem}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="sm:max-w-64">
            <label htmlFor={codeId} className="mb-2 block text-sm font-medium">
              Código do convite
            </label>
            <input
              id={codeId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{6}"
              maxLength={6}
              className="input-field font-mono tracking-[0.3em]"
              placeholder="000000"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              aria-describedby={descriptionId}
              disabled={preview || !userId || dashboard.redeeming}
              required
            />
          </div>
          <button
            type="submit"
            className="button-primary"
            disabled={
              preview || !userId || dashboard.redeeming || code.length !== 6
            }
          >
            {dashboard.redeeming && (
              <LoaderCircle
                size={17}
                className="animate-spin"
                aria-hidden="true"
              />
            )}
            {dashboard.redeeming ? "Vinculando…" : "Vincular paciente"}
          </button>
        </form>
        {preview && (
          <p className="mt-3 text-sm text-stone-600">
            Entre na sua conta para resgatar convites. Os pacientes abaixo são
            fictícios.
          </p>
        )}
        {dashboard.redeemError && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800"
          >
            {dashboard.redeemError}
          </p>
        )}
        {dashboard.redeemSuccess && (
          <p
            role="status"
            className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {dashboard.redeemSuccess}
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <section
          className="surface self-start p-5"
          aria-labelledby="professional-patients-title"
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2
              id="professional-patients-title"
              className="flex items-center gap-2 font-semibold"
            >
              <Users size={19} className="text-brand-600" aria-hidden="true" />
              Pacientes vinculados
            </h2>
            <button
              type="button"
              className="rounded-xl p-2 text-brand-600 hover:bg-brand-50"
              onClick={dashboard.reload}
              aria-label="Atualizar pacientes"
              disabled={dashboard.loading}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </button>
          </div>
          {dashboard.loading ? (
            <p role="status" className="text-sm text-stone-600">
              Carregando pacientes…
            </p>
          ) : dashboard.error ? (
            <div>
              <p role="alert" className="text-sm text-red-800">
                {dashboard.error}
              </p>
              <button
                type="button"
                className="button-secondary mt-3"
                onClick={dashboard.reload}
              >
                Tentar novamente
              </button>
            </div>
          ) : !dashboard.patients.length ? (
            <p className="text-sm leading-6 text-stone-600">
              Nenhum paciente vinculado. Utilize um convite do responsável para
              começar.
            </p>
          ) : (
            <ul className="space-y-2">
              {dashboard.patients.map((patient) => (
                <li key={patient.id}>
                  <button
                    type="button"
                    aria-pressed={dashboard.selectedPatient?.id === patient.id}
                    onClick={() => dashboard.setSelectedId(patient.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left text-sm font-medium break-words ${dashboard.selectedPatient?.id === patient.id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-transparent text-stone-700 hover:bg-stone-50"}`}
                  >
                    {patient.nome}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="min-w-0 space-y-5"
          aria-label="Comunicações do paciente"
        >
          {!dashboard.selectedPatient ? (
            <div className="surface p-8 text-center">
              <ClipboardList
                size={30}
                className="mx-auto mb-3 text-brand-600"
                aria-hidden="true"
              />
              <h2 className="text-lg font-semibold">
                Acompanhamento de comunicação
              </h2>
              <p className="mt-2 text-sm text-stone-600">
                Selecione um paciente vinculado para consultar os registros e
                exportar o relatório.
              </p>
            </div>
          ) : (
            <>
              <div className="surface p-5 sm:p-6">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="eyebrow">Paciente</p>
                    <h2 className="mt-1 text-xl font-semibold break-words">
                      {dashboard.selectedPatient.nome}
                    </h2>
                    <p className="mt-1 text-sm text-stone-600">
                      Registros de utilização da prancha no período selecionado.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button-primary"
                    onClick={() => void exportReport()}
                    disabled={
                      dashboard.loading ||
                      dashboard.eventsLoading ||
                      Boolean(dashboard.eventsError || dashboard.periodError) ||
                      pendingExport
                    }
                  >
                    {pendingExport ? (
                      <LoaderCircle
                        size={17}
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Download size={17} aria-hidden="true" />
                    )}
                    {pendingExport ? "Preparando PDF…" : "Exportar PDF"}
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={fromId}
                      className="mb-2 block text-sm font-medium"
                    >
                      Data inicial
                    </label>
                    <input
                      id={fromId}
                      type="date"
                      min="2020-01-01"
                      max={todayInSaoPaulo()}
                      className="input-field"
                      value={dashboard.period.from}
                      onChange={(event) =>
                        dashboard.setPeriod((period) => ({
                          ...period,
                          from: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={toId}
                      className="mb-2 block text-sm font-medium"
                    >
                      Data final
                    </label>
                    <input
                      id={toId}
                      type="date"
                      min="2020-01-01"
                      max={todayInSaoPaulo()}
                      className="input-field"
                      value={dashboard.period.to}
                      onChange={(event) =>
                        dashboard.setPeriod((period) => ({
                          ...period,
                          to: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-stone-500">
                  Datas e horários no fuso de São Paulo. Até 366 dias por
                  relatório.
                </p>
                {dashboard.periodError && (
                  <p role="alert" className="mt-3 text-sm text-red-800">
                    {dashboard.periodError}
                  </p>
                )}
                {exportError && (
                  <p role="alert" className="mt-3 text-sm text-red-800">
                    {exportError}
                  </p>
                )}
                {exportSuccess && (
                  <p role="status" className="mt-3 text-sm text-emerald-800">
                    Relatório PDF exportado.
                  </p>
                )}
              </div>

              {dashboard.eventsLoading ? (
                <div className="surface p-6">
                  <p role="status" className="text-sm text-stone-600">
                    Carregando comunicações…
                  </p>
                </div>
              ) : dashboard.eventsError ? (
                <div className="surface p-6">
                  <p role="alert" className="text-sm text-red-800">
                    {dashboard.eventsError}
                  </p>
                  <button
                    type="button"
                    className="button-secondary mt-3"
                    onClick={dashboard.reload}
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : (
                !dashboard.periodError && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {[
                        ["Comunicações", dashboard.events.length],
                        [
                          "Símbolos diferentes",
                          new Set(
                            dashboard.events.map(
                              (event) => event.pictograma_id,
                            ),
                          ).size,
                        ],
                        [
                          "Categorias",
                          new Set(
                            dashboard.events.map((event) => event.categoria),
                          ).size,
                        ],
                      ].map(([label, value]) => (
                        <div key={label} className="surface p-5">
                          <p className="text-2xl font-semibold">{value}</p>
                          <p className="mt-1 text-sm text-stone-600">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="surface overflow-hidden">
                      {!dashboard.events.length ? (
                        <p className="p-6 text-sm text-stone-600">
                          Nenhuma comunicação registrada neste período.
                        </p>
                      ) : (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                              <caption className="sr-only">
                                Comunicações de {dashboard.selectedPatient.nome}
                              </caption>
                              <thead className="bg-brand-50">
                                <tr>
                                  <th
                                    scope="col"
                                    className="px-5 py-3 font-semibold"
                                  >
                                    Data e hora
                                  </th>
                                  <th
                                    scope="col"
                                    className="px-5 py-3 font-semibold"
                                  >
                                    Símbolo
                                  </th>
                                  <th
                                    scope="col"
                                    className="px-5 py-3 font-semibold"
                                  >
                                    Categoria
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-100">
                                {rows.map((event) => (
                                  <tr key={event.id}>
                                    <td className="px-5 py-4 whitespace-nowrap">
                                      <time dateTime={event.created_at}>
                                        {dateTime.format(
                                          new Date(event.created_at),
                                        )}
                                      </time>
                                    </td>
                                    <td className="max-w-64 px-5 py-4 font-medium break-words">
                                      {event.rotulo}
                                    </td>
                                    <td className="max-w-48 px-5 py-4 break-words">
                                      {event.categoria}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 p-4">
                            <p className="text-xs text-stone-600">
                              Página {visiblePage + 1} de {pages} ·{" "}
                              {dashboard.events.length} registros no PDF
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="button-secondary"
                                disabled={visiblePage === 0}
                                onClick={() =>
                                  setPage((value) => Math.max(0, value - 1))
                                }
                              >
                                Anterior
                              </button>
                              <button
                                type="button"
                                className="button-secondary"
                                disabled={visiblePage + 1 >= pages}
                                onClick={() => setPage((value) => value + 1)}
                              >
                                Próxima
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
