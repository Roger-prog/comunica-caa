import { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Clock3,
  MessageCircle,
  Search,
  Sparkles,
} from "lucide-react";
import type { Comunicacao } from "../lib/database.types";
import { PICTOGRAMS } from "../data/pictograms";
import { HISTORY_LIMIT } from "../hooks/useWorkspace";

const symbolById = new Map(PICTOGRAMS.map((item) => [item.id, item.symbol]));
const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

function EmptyActivity({ onBoard }: { onBoard: () => void }) {
  return (
    <div className="surface px-6 py-16 text-center">
      <MessageCircle
        className="mx-auto mb-4 text-brand-600"
        size={34}
        aria-hidden="true"
      />
      <h2 className="text-xl font-semibold">Cada expressão tem um começo</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
        Use os símbolos da prancha para começar a acompanhar as comunicações
        deste perfil.
      </p>
      <button className="button-primary mt-6" onClick={onBoard}>
        Ir para a prancha <ArrowUpRight size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

export function Evolution({
  events,
  onBoard,
}: {
  events: Comunicacao[];
  onBoard: () => void;
}) {
  const [days, setDays] = useState(7);
  const recent = useMemo(
    () =>
      events.filter(
        (event) =>
          Date.parse(event.created_at) >= Date.now() - days * 86_400_000,
      ),
    [events, days],
  );
  const counts = new Map<string, number>();
  recent.forEach((event) =>
    counts.set(event.rotulo, (counts.get(event.rotulo) ?? 0) + 1),
  );
  const topWords = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const categories = new Set(recent.map((event) => event.categoria));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-xl text-sm leading-6 text-stone-600">
          Observe como a prancha é utilizada ao longo do tempo.
        </p>
        <label className="flex items-center gap-3 text-sm font-medium">
          Período
          <select
            className="input-field w-auto"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Comunicações", value: recent.length, Icon: MessageCircle },
          {
            label: "Símbolos diferentes",
            value: new Set(recent.map((event) => event.pictograma_id)).size,
            Icon: Sparkles,
          },
          {
            label: "Categorias exploradas",
            value: categories.size,
            Icon: Activity,
          },
        ].map(({ label, value, Icon }) => (
          <div className="surface p-6" key={label}>
            <Icon
              size={21}
              className="mb-4 text-brand-600"
              aria-hidden="true"
            />
            <p className="text-3xl font-semibold tracking-tight">{value}</p>
            <p className="mt-1 text-sm text-stone-600">{label}</p>
          </div>
        ))}
      </div>
      {recent.length ? (
        <section className="surface p-6" aria-labelledby="frequent-symbols">
          <h2 id="frequent-symbols" className="mb-6 text-lg font-semibold">
            Símbolos mais utilizados
          </h2>
          <ul className="space-y-5">
            {topWords.map(([label, count]) => (
              <li key={label}>
                <div className="mb-2 flex justify-between gap-3 text-sm">
                  <span className="font-medium">{label}</span>
                  <span className="text-stone-600">
                    {count} {count === 1 ? "toque" : "toques"}
                  </span>
                </div>
                <div
                  className="h-3 overflow-hidden rounded-full bg-brand-50"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-brand-600"
                    style={{ width: `${(count / topWords[0][1]) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyActivity onBoard={onBoard} />
      )}
      <p className="text-xs leading-5 text-stone-500">
        Indicadores de uso calculados sobre até {HISTORY_LIMIT} registros
        recentes deste perfil. Toques não representam domínio de palavras,
        diagnóstico ou avaliação clínica.
      </p>
    </div>
  );
}

export function History({
  events,
  loading,
  onBoard,
}: {
  events: Comunicacao[];
  loading: boolean;
  onBoard: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = events.filter((event) =>
    `${event.rotulo} ${event.categoria}`
      .toLocaleLowerCase("pt-BR")
      .includes(search.toLocaleLowerCase("pt-BR").trim()),
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-sm text-stone-600">
          Até {HISTORY_LIMIT} comunicações recentes do perfil selecionado.
        </p>
        <label className="relative sm:w-64">
          <span className="sr-only">Buscar no histórico</span>
          <Search
            size={17}
            className="absolute top-4 left-4 text-stone-400"
            aria-hidden="true"
          />
          <input
            className="input-field pl-11"
            type="search"
            placeholder="Buscar no histórico…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {loading && (
        <p role="status" className="text-sm text-stone-600">
          Atualizando histórico…
        </p>
      )}
      {!events.length && !loading ? (
        <EmptyActivity onBoard={onBoard} />
      ) : (
        <section
          className="surface overflow-hidden"
          aria-label="Registros de comunicação"
        >
          <ul className="divide-y divide-stone-100">
            {filtered.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center gap-4 p-5"
              >
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-2xl"
                  aria-hidden="true"
                >
                  {symbolById.get(event.pictograma_id) ?? "💬"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-words">{event.rotulo}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {event.categoria}
                  </p>
                </div>
                <time
                  className="flex items-center gap-2 text-xs text-stone-500"
                  dateTime={event.created_at}
                >
                  <Clock3 size={14} aria-hidden="true" />
                  {dateFormat.format(new Date(event.created_at))}
                </time>
              </li>
            ))}
          </ul>
          {!filtered.length && events.length > 0 && (
            <p className="p-8 text-center text-sm text-stone-500">
              Nenhum registro corresponde à busca.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
