import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Clock3, Hand, MessageCircle, Search, Sparkles } from "lucide-react";
import type { Pictogram } from "../data/pictograms";
import {
  activityDateTime,
  activityInPeriod,
  dailyActivity,
  eventTypeLabel,
  filterActivity,
  recentActivityPeriod,
  summarizeActivity,
  todayInSaoPaulo,
  validateActivityPeriod,
  type ActivityFilter,
  type ActivityPeriod,
} from "../lib/activityEvents";
import type { Comunicacao } from "../lib/database.types";
import { fetchGuardianPatientEvents, ProfessionalError } from "../lib/professional";
import { ActivitySymbol } from "./ActivitySymbol";

const noEvents: Comunicacao[] = [];
const shortDay = (day: string) => day.slice(5).split("-").reverse().join("/");

function EmptyActivity({ onBoard }: { onBoard: () => void }) {
  return (
    <div className="surface px-6 py-16 text-center">
      <MessageCircle className="mx-auto mb-4 text-brand-600" size={34} aria-hidden="true" />
      <h2 className="text-xl font-semibold">Nenhum registro de comunicação</h2>
      <button className="button-primary mt-6" onClick={onBoard}>
        Ir para a prancha <ArrowUpRight size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

function DailyActivityChart({
  period, byDay,
}: { period: ActivityPeriod; byDay: ReturnType<typeof summarizeActivity>["byDay"] }) {
  const days = dailyActivity(period, byDay);
  const peak = Math.max(1, ...days.flatMap(({ selections, messages }) => [selections, messages]));
  const unitWidth = 640 / days.length;
  const barWidth = Math.min(20, unitWidth * 0.36);
  return (
    <section className="surface p-4 sm:p-6" aria-labelledby="daily-activity">
      <h2 id="daily-activity" className="text-lg font-semibold">Uso da prancha por dia</h2>
      <div className="my-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-stone-700" aria-hidden="true">
        <span className="flex items-center gap-2"><span className="size-3 rounded-sm bg-brand-700" />Seleções</span>
        <span className="flex items-center gap-2"><span className="size-3 rounded-sm border border-emerald-800 bg-emerald-200" />Mensagens</span>
      </div>
      <svg viewBox="0 0 640 124" preserveAspectRatio="none" className="h-28 w-full sm:h-40" aria-hidden="true">
        {[0, 40, 80, 120].map((y) => <line key={y} x1="0" x2="640" y1={y} y2={y} className="stroke-stone-200" vectorEffect="non-scaling-stroke" />)}
        {days.map(({ day, selections, messages }, index) => {
          const x = unitWidth * (index + 0.5);
          const selectionHeight = 120 * selections / peak;
          const messageHeight = 120 * messages / peak;
          return (
            <g key={day}>
              <title>{shortDay(day)} · {selections} seleções · {messages} mensagens</title>
              {selections > 0 && <rect x={x - barWidth} y={120 - selectionHeight} width={barWidth} height={selectionHeight} className="fill-brand-700" />}
              {messages > 0 && <rect x={x} y={120 - messageHeight} width={barWidth} height={messageHeight} className="fill-emerald-200 stroke-emerald-800" strokeWidth={0.5} />}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-xs text-stone-600" aria-hidden="true">
        <span>{shortDay(period.from)}</span>
        {period.to !== period.from && <span>{shortDay(period.to)}</span>}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer py-2 text-sm font-semibold text-brand-700">Ver dados por dia</summary>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Contagem por dia em horário de Brasília</caption>
            <thead className="bg-stone-50"><tr><th scope="col" className="px-2 py-3">Dia</th><th scope="col" className="px-2 py-3">Seleções</th><th scope="col" className="px-2 py-3">Mensagens</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {days.map(({ day, selections, messages }) => (
                <tr key={day}>
                  <th scope="row" className="px-2 py-2 font-normal"><time dateTime={day}>{day.split("-").reverse().join("/")}</time></th>
                  <td className="px-2 py-2">{selections}</td><td className="px-2 py-2">{messages}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function Evolution({
  events, onBoard, patientId, loading = false,
}: {
  events: Comunicacao[];
  onBoard: () => void;
  patientId?: string;
  loading?: boolean;
}) {
  const [range, setRange] = useState("7");
  const [custom, setCustom] = useState<ActivityPeriod>(() => recentActivityPeriod(7));
  const [retry, setRetry] = useState(0);
  const [remote, setRemote] = useState<{
    key: string;
    localSnapshot: Comunicacao[];
    events: Comunicacao[];
    error?: string;
  } | null>(null);
  const today = todayInSaoPaulo();
  const period = range === "custom" ? custom : recentActivityPeriod(Number(range), today);
  const { from, to } = period;
  const invalidPeriod = validateActivityPeriod(period, today);
  const key = patientId ? `${patientId}/${from}/${to}/${retry}` : "";
  const active = remote?.key === key && remote.localSnapshot === events ? remote : null;

  useEffect(() => {
    if (!patientId || !key || invalidPeriod) return;
    const controller = new AbortController();
    void fetchGuardianPatientEvents(patientId, { from, to }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setRemote({ key, localSnapshot: events, events: data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRemote({ key, localSnapshot: events, events: noEvents, error: error instanceof ProfessionalError
            ? error.message
            : "Não foi possível carregar os registros do período." });
        }
      });
    // Refresh after a local write or deletion. The server result replaces the
    // previous snapshot so that deleted rows cannot get merged back.
    return () => controller.abort();
  }, [patientId, key, invalidPeriod, from, to, events]);

  const visible = useMemo(
    () => patientId ? active?.events ?? noEvents : activityInPeriod(events, { from, to }),
    [patientId, active, events, from, to],
  );
  const summary = useMemo(() => summarizeActivity(visible), [visible]);
  const waiting = patientId ? !active : loading;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-2 text-sm font-medium">
          Período
          <select className="input-field w-auto" value={range} onChange={(event) => setRange(event.target.value)}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="custom">Período personalizado</option>
          </select>
        </label>
        {range === "custom" && (
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-2 text-sm font-medium">
              Data inicial
              <input className="input-field w-auto" type="date" min="2020-01-01" max={today} value={from}
                onChange={(event) => setCustom((current) => ({ ...current, from: event.target.value }))} />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Data final
              <input className="input-field w-auto" type="date" min="2020-01-01" max={today} value={to}
                onChange={(event) => setCustom((current) => ({ ...current, to: event.target.value }))} />
            </label>
          </div>
        )}
      </div>
      {invalidPeriod ? <p role="alert" className="text-sm text-red-800">{invalidPeriod}</p>
        : waiting ? <p role="status" className="text-sm text-stone-600">Carregando registros do período…</p>
        : active?.error ? (
          <div className="surface space-y-3 p-5">
            <p role="alert" className="text-sm text-red-800">{active.error}</p>
            <button type="button" className="button-secondary" onClick={() => setRetry((current) => current + 1)}>Tentar novamente</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Seleções de símbolos", value: summary.selections, Icon: Hand },
                { label: "Mensagens reproduzidas", value: summary.messages, Icon: MessageCircle },
                { label: "Símbolos diferentes utilizados", value: summary.symbols, Icon: Sparkles },
                { label: "Categorias utilizadas", value: summary.categories, Icon: Activity },
              ].map(({ label, value, Icon }) => (
                <div className="surface p-5" key={label}>
                  <Icon size={21} className="mb-4 text-brand-600" aria-hidden="true" />
                  <p className="text-3xl font-semibold tracking-tight">{value.toLocaleString("pt-BR")}</p>
                  <p className="mt-1 text-sm text-stone-600">{label}</p>
                </div>
              ))}
            </div>
            {visible.length || patientId ? <DailyActivityChart period={period} byDay={summary.byDay} /> : null}
            {!visible.length && <EmptyActivity onBoard={onBoard} />}
            {summary.top.length > 0 && (
              <section className="surface p-6" aria-labelledby="frequent-symbols">
                <h2 id="frequent-symbols" className="mb-6 text-lg font-semibold">Símbolos mais utilizados</h2>
                <ul className="space-y-5">
                  {summary.top.map(({ id, label, count, custom: isCustom }) => (
                    <li key={id}>
                      <div className="mb-2 flex justify-between gap-3 text-sm">
                        <span className="min-w-0 font-medium break-words">
                          {label}{isCustom && <span className="ml-2 text-xs font-normal text-stone-600">Personalizado</span>}
                        </span>
                        <span className="shrink-0 text-stone-600">{count} {count === 1 ? "seleção" : "seleções"}</span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${100 * count / summary.top[0].count}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-xs leading-5 text-stone-600">
              Categorias são contadas quando um símbolo da categoria é selecionado.
              {summary.legacy > 0 && " Os registros anteriores sem distinção entre seleção e reprodução estão disponíveis no histórico."}
              {" Os indicadores descrevem a utilização da prancha. A interpretação clínica cabe aos profissionais responsáveis."}
            </p>
          </>
        )}
    </div>
  );
}

export function History({
  events, loading, onBoard, catalog, hasOlder = false, loadOlder,
}: {
  events: Comunicacao[];
  loading: boolean;
  onBoard: () => void;
  catalog?: readonly Pictogram[];
  hasOlder?: boolean;
  loadOlder?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const filtered = useMemo(() => filterActivity(events, filter, search), [events, filter, search]);
  const byId = useMemo(() => catalog ? new Map(catalog.map((item) => [item.id, item])) : undefined, [catalog]);
  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-600">
        Horário de Brasília.{hasOlder ? " A busca considera os registros carregados." : ""}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-2 text-sm font-medium">
          Tipo de evento
          <select className="input-field w-auto" value={filter} onChange={(event) => setFilter(event.target.value as ActivityFilter)}>
            <option value="all">Todos os eventos</option>
            <option value="symbol_selection">Seleções de símbolos</option>
            <option value="message_playback">Mensagens reproduzidas</option>
          </select>
        </label>
        <label className="relative min-w-36 flex-1 sm:max-w-64">
          <span className="sr-only">Buscar no histórico</span>
          <Search size={17} className="absolute top-4 left-4 text-stone-400" aria-hidden="true" />
          <input className="input-field pl-11" type="search" placeholder="Buscar no histórico…" value={search}
            onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>
      {loading && <p role="status" className="text-sm text-stone-600">Atualizando histórico…</p>}
      {!events.length && !loading ? <EmptyActivity onBoard={onBoard} /> : (
        <section className="surface overflow-hidden" aria-label="Registros de comunicação" aria-busy={loading}>
          <ul className="divide-y divide-stone-100">
            {filtered.map((event) => (
              <li key={event.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 p-4 sm:p-5">
                <ActivitySymbol event={event} catalog={byId} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-words">{event.rotulo}</p>
                  <p className="mt-1 text-xs text-stone-600">
                    {[eventTypeLabel(event), event.symbol_source === "custom" ? "Personalizado" : null, event.categoria].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <time className="flex items-center gap-2 text-xs text-stone-600" dateTime={event.created_at}>
                  <Clock3 size={14} aria-hidden="true" />
                  {activityDateTime.format(new Date(event.created_at))}
                </time>
              </li>
            ))}
          </ul>
          {!filtered.length && events.length > 0 && <p className="p-8 text-center text-sm text-stone-600">Nenhum registro corresponde aos filtros.</p>}
        </section>
      )}
      {hasOlder && loadOlder && (
        <button type="button" className="button-secondary" disabled={loading} onClick={loadOlder}>
          Carregar registros anteriores
        </button>
      )}
    </div>
  );
}
