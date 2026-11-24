import { useCallback, useEffect, useMemo, useState } from "react";
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

  const events = byChild[selectedId] ?? EMPTY_EVENTS;
  const selectedChild = useMemo(
    () => children.find((child) => child.id === selectedId) ?? null,
    [children, selectedId],
  );

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
      if (!enabled || !selectedChild) return;
      const event = {
        ...details,
        id: crypto.randomUUID(),
        usuario_id: selectedChild.usuario_id,
        crianca_id: selectedId,
      };
      const append = (stored: Comunicacao) =>
        setByChild((current) => ({
          ...current,
          // Connected views load from the server. Keep only a refresh snapshot.
          [selectedId]: preview ? mergeEvents(current[selectedId] ?? [], [stored]) : [stored],
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
    [selectedId, selectedChild, enabled, preview, user?.id],
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
    if (!enabled || preview || !selectedChild || !supabase || selectedChild.usuario_id !== user?.id) {
      throw new Error("Este perfil não permite excluir o histórico.");
    }
    const scoped = supabase.from("comunicacoes").delete()
      .eq("usuario_id", user.id).eq("crianca_id", selectedId);
    const { error: requestError } = await (before ? scoped.lt("created_at", before) : scoped);
    if (requestError) throw new Error("Não foi possível excluir os registros. Tente novamente.");

    setByChild((current) => ({ ...current, [selectedId]: [] }));
  }, [enabled, preview, selectedChild, selectedId, user?.id]);

  return {
    profile,
    children,
    selectedChild,
    selectedId,
    setSelectedId,
    events,
    loading,
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
