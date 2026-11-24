import { normalizeVocabularyText } from "../data/pictograms";
import type { ActivityFilter, ActivityPeriod } from "./activityEvents";
import type { Comunicacao } from "./database.types";
import { supabase } from "./supabase";

const PAGE_SIZE = 100;

export async function fetchHistoryPage(
  patientId: string, period: ActivityPeriod | null, filter: ActivityFilter, search: string,
  cursor: Comunicacao | undefined, signal: AbortSignal,
) {
  if (!supabase) throw new Error("A conexão com o histórico está indisponível.");
  const { data, error } = await supabase.rpc("query_caa_history", {
    p_crianca_id: patientId,
    p_from: period?.from ?? null,
    p_to: period?.to ?? null,
    p_event_type: filter === "all" ? null : filter,
    p_search: normalizeVocabularyText(search),
    p_before_time: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
  }).abortSignal(signal);
  if (error) throw new Error("Não foi possível carregar o histórico. Verifique sua conexão e tente novamente.");
  return { events: data.slice(0, PAGE_SIZE), hasOlder: data.length > PAGE_SIZE };
}
