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
export const HISTORY_LIMIT = 500;

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
    )
    .slice(0, HISTORY_LIMIT);
}

function dataError(): string {
  return "Não foi possível acessar os dados. Verifique sua conexão e tente novamente. Se o problema continuar, contate o responsável pelo sistema.";
}

// App remounts this workspace whenever the authenticated user or mode changes.
export function useWorkspace(user: User | null, preview: boolean) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [children, setChildren] = useState<Crianca[]>(
    preview ? [demoChild] : [],
  );
  const [selectedId, setSelectedId] = useState(preview ? demoChild.id : "");
  const [byChild, setByChild] = useState<Record<string, Comunicacao[]>>({});
  const [loading, setLoading] = useState(!preview);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (preview || !supabase || !user) return;
    const client = supabase;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      client
        .from("profiles")
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
  }, [user?.id, preview, reloadVersion]);

  useEffect(() => {
    if (preview || !supabase || !user || !selectedId) return;
    const controller = new AbortController();
    let active = true;
    setHistoryLoading(true);
    void Promise.resolve(
      supabase
        .from("comunicacoes")
        .select("*")
        .eq("usuario_id", user.id)
        .eq("crianca_id", selectedId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(HISTORY_LIMIT)
        .abortSignal(controller.signal),
    )
      .then(({ data, error: requestError }) => {
        if (!active) return;
        if (requestError) throw new Error("history_load");
        setByChild((current) => ({
          ...current,
          [selectedId]: mergeEvents(current[selectedId] ?? [], data),
        }));
      })
      .catch(() => {
        if (active) setError(dataError());
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [user?.id, preview, selectedId, reloadVersion]);

  const addChild = useCallback(
    async (nome: string) => {
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
    [preview, user?.id],
  );

  const record = useCallback(
    (pictogram: Pictogram) => {
      if (!selectedId) return;
      const id = crypto.randomUUID();
      if (preview) {
        const event: Comunicacao = {
          id,
          usuario_id: "demo",
          crianca_id: selectedId,
          pictograma_id: pictogram.id,
          rotulo: pictogram.label,
          categoria: pictogram.category,
          created_at: new Date().toISOString(),
        };
        setByChild((current) => ({
          ...current,
          [selectedId]: mergeEvents(current[selectedId] ?? [], [event]),
        }));
        return;
      }
      if (!supabase || !user) return;
      setPendingWrites((count) => count + 1);
      void Promise.resolve(
        supabase
          .from("comunicacoes")
          .insert({
            id,
            usuario_id: user.id,
            crianca_id: selectedId,
            pictograma_id: pictogram.id,
            rotulo: pictogram.label,
            categoria: pictogram.category,
          })
          .select("*")
          .single(),
      )
        .then(({ data, error: requestError }) => {
          if (requestError) throw new Error("record_save");
          setByChild((current) => ({
            ...current,
            [selectedId]: mergeEvents(current[selectedId] ?? [], [data]),
          }));
        })
        .catch(() =>
          setSaveError(
            "O áudio foi acionado, mas não foi possível confirmar o registro deste toque. Verifique sua conexão antes de continuar.",
          ),
        )
        .finally(() => setPendingWrites((count) => count - 1));
    },
    [selectedId, preview, user?.id],
  );

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
    events: byChild[selectedId] ?? [],
    loading,
    historyLoading,
    error,
    saveError,
    pendingWrites,
    addChild,
    record,
    reload: () => setReloadVersion((value) => value + 1),
    dismissSaveError: () => setSaveError(null),
  };
}
