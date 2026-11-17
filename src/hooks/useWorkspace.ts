import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Comunicacao, Crianca, Profile } from "../lib/database.types";
import type { Pictogram } from "../data/pictograms";
import { supabase } from "../lib/supabase";

const demoChild: Crianca = {
  id: "demo",
  usuario_id: "demo",
  nome: "Perfil de demonstração",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
export const HISTORY_LIMIT = 500;
const EMPTY_EVENTS: Comunicacao[] = [];
type EventDetails = Pick<Comunicacao,
  "event_type" | "symbol_source" | "arasaac_id" | "pictograma_id" | "rotulo" | "categoria"
>;

export function mergeEvents(
  previous: Comunicacao[],
  incoming: Comunicacao[],
): Comunicacao[] {
  const events = new Map(previous.map((event) => [event.id, event]));
  incoming.forEach((event) => events.set(event.id, event));
  return [...events.values()]
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
}

function dataError(): string {
  return "Não foi possível acessar os dados. Verifique sua conexão e tente novamente. Se o problema continuar, contate o responsável pelo sistema.";
}

// App remounts this workspace whenever the authenticated user or mode changes.
export function useWorkspace(
  user: User | null,
  preview: boolean,
  enabled = true,
) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [children, setChildren] = useState<Crianca[]>(
    preview ? [demoChild] : [],
  );
  const [selectedId, setSelectedId] = useState(preview ? demoChild.id : "");
  const [byChild, setByChild] = useState<Record<string, Comunicacao[]>>({});
  const [loading, setLoading] = useState(!preview && enabled);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [olderByChild, setOlderByChild] = useState<Record<string, boolean>>({});
  const historyRequest = useRef<AbortController | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (!enabled || preview || !supabase || !user) return;
    const client = supabase;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      client
        .from("caa_profiles")
        .select("*")
        .eq("id", user.id)
        .abortSignal(controller.signal)
        .single(),
      client
        .from("criancas")
        .select("*")
        .eq("usuario_id", user.id)
        .order("nome")
        .abortSignal(controller.signal),
    ])
      .then(([person, list]) => {
        if (!active) return;
        if (person.error || list.error) throw new Error("workspace_load");
        setProfile(person.data);
        setChildren(list.data);
        setSelectedId((current) =>
          list.data.some((child) => child.id === current)
            ? current
            : (list.data[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (active) setError(dataError());
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [user?.id, preview, enabled, reloadVersion]);

  useEffect(() => {
    if (!enabled || preview || !supabase || !user || !selectedId) {
      setHistoryLoading(false);
      return;
    }
    const controller = new AbortController();
    historyRequest.current = controller;
    setByChild((current) => ({ ...current, [selectedId]: EMPTY_EVENTS }));
    setOlderByChild((current) => ({ ...current, [selectedId]: false }));
    setHistoryLoading(true);
    void Promise.resolve(
      supabase
        .from("comunicacoes")
        .select("*")
        .eq("usuario_id", user.id)
        .eq("crianca_id", selectedId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(HISTORY_LIMIT + 1)
        .abortSignal(controller.signal),
    )
      .then(({ data, error: requestError }) => {
        if (controller.signal.aborted) return;
        if (requestError) throw new Error("history_load");
        setByChild((current) => ({
          ...current,
          [selectedId]: mergeEvents(current[selectedId] ?? [], data.slice(0, HISTORY_LIMIT)),
        }));
        setOlderByChild((current) => ({ ...current, [selectedId]: data.length > HISTORY_LIMIT }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(dataError());
      })
      .finally(() => {
        if (historyRequest.current !== controller) return;
        historyRequest.current = null;
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => {
      historyRequest.current?.abort();
      historyRequest.current = null;
    };
  }, [user?.id, preview, enabled, selectedId, reloadVersion, historyVersion]);

  const events = byChild[selectedId] ?? EMPTY_EVENTS;
  const hasOlder = olderByChild[selectedId] === true;

  async function loadOlder() {
    const oldest = events.at(-1);
    if (!hasOlder || !oldest || !supabase || !user || preview || historyRequest.current) return;
    const controller = new AbortController();
    historyRequest.current = controller;
    setHistoryLoading(true);
    setError(null);
    try {
      const { data, error: requestError } = await supabase
        .from("comunicacoes")
        .select("*")
        .eq("usuario_id", user.id)
        .eq("crianca_id", selectedId)
        .or(`created_at.lt.${oldest.created_at},and(created_at.eq.${oldest.created_at},id.lt.${oldest.id})`)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(HISTORY_LIMIT + 1)
        .abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      if (requestError) throw new Error("history_load");
      setByChild((current) => ({
        ...current,
        [selectedId]: mergeEvents(current[selectedId] ?? [], data.slice(0, HISTORY_LIMIT)),
      }));
      setOlderByChild((current) => ({ ...current, [selectedId]: data.length > HISTORY_LIMIT }));
    } catch {
      if (!controller.signal.aborted) setError(dataError());
    } finally {
      if (historyRequest.current === controller) {
        historyRequest.current = null;
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
  }

  const addChild = useCallback(
    async (nome: string) => {
      if (!enabled)
        throw new Error(
          "Este tipo de conta não pode criar perfis de crianças.",
        );
      const name = nome.trim();
      if (!name || name.length > 80)
        throw new Error("Informe um nome com até 80 caracteres.");
      let child: Crianca;
      if (preview) {
        const now = new Date().toISOString();
        child = {
          id: crypto.randomUUID(),
          usuario_id: "demo",
          nome: name,
          created_at: now,
          updated_at: now,
        };
      } else {
        if (!supabase || !user)
          throw new Error("Entre novamente para continuar.");
        const { data, error: requestError } = await supabase
          .from("criancas")
          .insert({ usuario_id: user.id, nome: name })
          .select("*")
          .single();
        if (requestError) throw new Error(dataError());
        child = data;
      }
      setChildren((current) =>
        [...current, child].sort((a, b) =>
          a.nome.localeCompare(b.nome, "pt-BR"),
        ),
      );
      setSelectedId(child.id);
      return child;
    },
    [preview, enabled, user?.id],
  );

  const recordEvent = useCallback(
    (details: EventDetails) => {
      if (!enabled || !selectedId) return;
      const event = {
        ...details,
        id: crypto.randomUUID(),
        usuario_id: preview ? "demo" : user?.id ?? "",
        crianca_id: selectedId,
      };
      const append = (stored: Comunicacao) =>
        setByChild((current) => ({
          ...current,
          [selectedId]: mergeEvents(current[selectedId] ?? [], [stored]),
        }));
      if (preview) {
        append({ ...event, created_at: new Date().toISOString() });
        return;
      }
      if (!supabase || !user) return;
      setPendingWrites((count) => count + 1);
      void Promise.resolve(
        supabase.from("comunicacoes").insert(event).select("*").single(),
      )
        .then(({ data, error: requestError }) => {
          if (requestError) throw new Error("record_save");
          append(data);
        })
        .catch(() =>
          setSaveError("Não foi possível confirmar o registro desta atividade. Confira sua conexão."),
        )
        .finally(() => setPendingWrites((count) => count - 1));
    },
    [selectedId, enabled, preview, user?.id],
  );

  const record = useCallback((pictogram: Pictogram) => {
    recordEvent({
      event_type: "symbol_selection",
      symbol_source: pictogram.source === "custom" ? "custom" : "catalog",
      arasaac_id: pictogram.imagePath ? null : pictogram.arasaacId ?? null,
      pictograma_id: pictogram.id,
      rotulo: pictogram.label,
      categoria: pictogram.category,
    });
  }, [recordEvent]);

  const recordMessage = useCallback((text: string) => {
    recordEvent({
      event_type: "message_playback",
      symbol_source: null,
      arasaac_id: null,
      pictograma_id: null,
      rotulo: text,
      categoria: null,
    });
  }, [recordEvent]);

  const deleteHistory = useCallback(async (before: string | null) => {
    if (!enabled || preview || !selectedId || !supabase || !user) {
      throw new Error("Este perfil não permite excluir o histórico.");
    }
    const scoped = supabase.from("comunicacoes").delete()
      .eq("usuario_id", user.id).eq("crianca_id", selectedId);
    const { error: requestError } = await (before ? scoped.lt("created_at", before) : scoped);
    if (requestError) throw new Error("Não foi possível excluir os registros. Tente novamente.");

    historyRequest.current?.abort();
    setByChild((current) => ({
      ...current,
      [selectedId]: (current[selectedId] ?? []).filter((event) =>
        before !== null && Date.parse(event.created_at) >= Date.parse(before)),
    }));
    setOlderByChild((current) => {
      const remaining = { ...current };
      delete remaining[selectedId];
      return remaining;
    });
    setHistoryVersion((current) => current + 1);
  }, [enabled, preview, selectedId, user?.id]);

  const selectedChild = useMemo(
    () => children.find((child) => child.id === selectedId) ?? null,
    [children, selectedId],
  );
  return {
    profile,
    children,
    selectedChild,
    selectedId,
    setSelectedId,
    events,
    hasOlder,
    loadOlder,
    loading,
    historyLoading,
    error,
    saveError,
    pendingWrites,
    addChild,
    record,
    recordMessage,
    deleteHistory,
    reload: () => setReloadVersion((value) => value + 1),
    dismissSaveError: () => setSaveError(null),
  };
}
