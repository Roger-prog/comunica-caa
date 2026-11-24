import { normalizeVocabularyText } from "../data/pictograms";
import type { Comunicacao } from "./database.types";

export type ActivityPeriod = { from: string; to: string };
export type ActivityEventType = Comunicacao["event_type"];
export type ActivityFilter = "all" | "symbol_selection" | "message_playback";

const dayFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const activityDateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});
const DAY_MS = 86_400_000;

export function todayInSaoPaulo(now = new Date()) {
  return dayFormatter.format(now);
}

export function recentActivityPeriod(days: number, to = todayInSaoPaulo()): ActivityPeriod {
  return { from: new Date(Date.parse(to) - (days - 1) * DAY_MS).toISOString().slice(0, 10), to };
}

function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

export function validateActivityPeriod(
  period: ActivityPeriod, today = todayInSaoPaulo(), maximumDays = 366,
): string | null {
  const from = dateValue(period.from);
  const to = dateValue(period.to);
  if (from === null || to === null) return "Informe as datas inicial e final do período.";
  if (period.from < "2020-01-01" || period.to > today) return "Escolha datas entre 01/01/2020 e hoje.";
  if (from > to) return "A data inicial deve ser anterior ou igual à data final.";
  if ((to - from) / DAY_MS + 1 > maximumDays) return `Escolha um período de até ${maximumDays} dias.`;
  return null;
}

export function eventType(event: Comunicacao): ActivityEventType {
  return event.event_type ?? "legacy_symbol";
}

export function eventTypeLabel(event: Comunicacao): string {
  switch (eventType(event)) {
    case "symbol_selection": return "Seleção de símbolo";
    case "message_playback": return "Mensagem reproduzida";
    case "legacy_symbol": return "Registro anterior";
  }
}

export function filterActivity(events: readonly Comunicacao[], filter: ActivityFilter, search: string) {
  const query = normalizeVocabularyText(search);
  return events.filter((event) =>
    (filter === "all" || eventType(event) === filter)
    && (!query || normalizeVocabularyText(
      [event.rotulo, event.categoria, eventTypeLabel(event), event.symbol_source === "custom" ? "Personalizado" : ""].join(" "),
    ).includes(query)),
  );
}

export function activityInPeriod(events: readonly Comunicacao[], period: ActivityPeriod) {
  return events.filter((event) => {
    const day = todayInSaoPaulo(new Date(event.created_at));
    return day >= period.from && day <= period.to;
  });
}

type SymbolCount = { id: string; label: string; custom: boolean; count: number; latest: number };
type DailyActivity = { day: string; selections: number; messages: number };

export function summarizeActivity(events: readonly Comunicacao[]) {
  const symbols = new Map<string, SymbolCount>();
  const categories = new Map<string, number>();
  const byDay = new Map<string, DailyActivity>();
  let selections = 0;
  let messages = 0;
  let legacy = 0;
  for (const event of events) {
    const type = eventType(event);
    if (type === "legacy_symbol") {
      legacy++;
      continue;
    }
    const day = todayInSaoPaulo(new Date(event.created_at));
    const daily = byDay.get(day) ?? { day, selections: 0, messages: 0 };
    byDay.set(day, daily);
    if (type === "message_playback") {
      daily.messages++;
      messages++;
      continue;
    }
    daily.selections++;
    selections++;
    if (event.categoria) categories.set(event.categoria, (categories.get(event.categoria) ?? 0) + 1);
    if (event.pictograma_id) {
      const id = `${event.symbol_source}:${event.pictograma_id}`;
      const timestamp = Date.parse(event.created_at);
      const previous = symbols.get(id);
      symbols.set(id, {
        id,
        label: !previous || timestamp >= previous.latest ? event.rotulo : previous.label,
        custom: event.symbol_source === "custom",
        count: (previous?.count ?? 0) + 1,
        latest: Math.max(timestamp, previous?.latest ?? timestamp),
      });
    }
  }
  const top = [...symbols.values()].sort((a, b) =>
    b.count - a.count || a.label.localeCompare(b.label, "pt-BR") || a.id.localeCompare(b.id),
  ).slice(0, 6);
  const byCategory = [...categories].sort(([a, n], [b, m]) => m - n || a.localeCompare(b, "pt-BR"));
  return { selections, messages, legacy, byCategory, categories: categories.size, symbols: symbols.size, top, byDay };
}

export function dailyActivity(period: ActivityPeriod, byDay: ReadonlyMap<string, DailyActivity>) {
  const days: DailyActivity[] = [];
  for (let time = Date.parse(period.from); time <= Date.parse(period.to); time += DAY_MS) {
    const day = new Date(time).toISOString().slice(0, 10);
    days.push(byDay.get(day) ?? { day, selections: 0, messages: 0 });
  }
  return days;
}
