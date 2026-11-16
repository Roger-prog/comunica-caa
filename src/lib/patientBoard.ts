import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import {
  DEFAULT_BOARD_SETTINGS, normalizeBoardSettings,
  type BoardSettings, type CatalogOverride, type CustomSymbol, type PatientBoard,
} from "./patientBoardModel";

export type { BoardSettings, CatalogOverride, CustomSymbol, PatientBoard } from "./patientBoardModel";
export { DEFAULT_BOARD_SETTINGS } from "./patientBoardModel";

const PHOTO_BUCKET = "caa-symbol-images";
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function client() {
  if (!supabase) throw new Error("Entre em uma conta conectada para personalizar a prancha.");
  return supabase;
}

function boardError(error?: { code?: string } | null) {
  if (error?.code === "42501") return new Error("O acesso a esta prancha foi revogado ou sua conta não tem permissão.");
  if (error?.code === "40001" || error?.code === "PT409") {
    return new Error("A prancha foi alterada em outra sessão. Atualize os dados e tente novamente.");
  }
  return new Error("Não foi possível salvar a alteração. Confira sua conexão e tente novamente.");
}

async function fetchPatientBoard(patientId: string, signal: AbortSignal): Promise<PatientBoard> {
  const service = client();
  const [permission, settings, symbols, overrides] = await Promise.all([
    service.rpc("has_caa_board_access", { p_crianca_id: patientId }).abortSignal(signal),
    service.from("caa_board_settings").select("*").eq("crianca_id", patientId).abortSignal(signal).maybeSingle(),
    service.from("caa_custom_symbols").select("*").eq("crianca_id", patientId).order("created_at").order("id").limit(250).abortSignal(signal),
    service.from("caa_catalog_overrides").select("*").eq("crianca_id", patientId).order("symbol_id").abortSignal(signal),
  ]);
  if (permission.error || settings.error || symbols.error || overrides.error) {
    throw new Error("Não foi possível carregar a personalização desta prancha. Confira a conexão.");
  }
  if (permission.data !== true) throw new Error("O acesso a esta prancha não está disponível.");
  return {
    settings: settings.data ? normalizeBoardSettings(settings.data.settings) : DEFAULT_BOARD_SETTINGS,
    settingsVersion: settings.data?.version ?? 0,
    symbols: symbols.data,
    overrides: overrides.data,
  };
}

type BoardLoad = {
  context: string;
  status: "loading" | "ready" | "error";
  board: PatientBoard | null;
  error: string | null;
};

export function usePatientBoard(patientId?: string | null, userId?: string | null, enabled = true) {
  const active = Boolean(enabled && patientId && userId && supabase);
  const context = active ? `${userId}/${patientId}` : "";
  const [request, setRequest] = useState(0);
  const [load, setLoad] = useState<BoardLoad | null>(null);
  const reload = useCallback(() => setRequest((value) => value + 1), []);

  useEffect(() => {
    if (!context || !patientId) {
      setLoad(null);
      return;
    }
    const controller = new AbortController();
    setLoad((current) => ({
      context, status: "loading", board: current?.context === context ? current.board : null, error: null,
    }));
    void fetchPatientBoard(patientId, controller.signal).then((board) => {
      if (!controller.signal.aborted) setLoad({ context, status: "ready", board, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setLoad({ context, status: "error", board: null, error: error instanceof Error ? error.message : "Prancha indisponível." });
      }
    });
    return () => controller.abort();
  }, [context, patientId, request]);

  useEffect(() => {
    if (!context) return;
    const refresh = () => { if (document.visibilityState !== "hidden") reload(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [context, reload]);

  if (!context) return { board: null, status: "idle" as const, error: null, reload };
  if (load?.context !== context) return { board: null, status: "loading" as const, error: null, reload };
  return { board: load.board, status: load.status, error: load.error, reload };
}

export async function saveBoardSettings(patientId: string, settings: BoardSettings, version: number) {
  const normalized = normalizeBoardSettings(settings);
  if (new TextEncoder().encode(JSON.stringify(normalized)).length > 14000) {
    throw new Error("Há muitas preferências de ordenação. Remova algumas e tente novamente.");
  }
  const { data, error } = await client().rpc("save_caa_board_settings", {
    p_crianca_id: patientId, p_settings: normalized, p_expected_version: version,
  }).single();
  if (error || !data) throw boardError(error);
  return data;
}

export type SymbolDraft = {
  label: string;
  speechText: string;
  categories: string[];
  arasaacId: number | null;
  imagePath: string | null;
  photo: Blob | null;
  photoAuthorized: boolean;
  hidden: boolean;
};

async function removePhoto(path: string) {
  const { data, error } = await client().storage.from(PHOTO_BUCKET).remove([path]);
  return !error && (data?.length ?? 0) > 0;
}

async function retireStagedPhoto(patientId: string, path: string) {
  try {
    const { error } = await client().rpc("discard_caa_symbol_image", { p_crianca_id: patientId, p_path: path });
    if (!error) await removePhoto(path);
  } catch {
    // An unattached upload is private and can be retried from the cleanup list.
  }
}

async function cleanRetiredPhoto(path: string | null) {
  if (!path) return false;
  try { return !await removePhoto(path); } catch { return true; }
}

export async function saveCustomSymbol(patientId: string, previous: CustomSymbol | null, draft: SymbolDraft) {
  const service = client();
  const label = draft.label.trim();
  const speechText = draft.speechText.trim() || label;
  if (!label || label.length > 80 || speechText.length > 150) throw new Error("Informe um nome de até 80 caracteres e uma fala de até 150 caracteres.");
  if (!draft.photo && !draft.imagePath && !draft.arasaacId) throw new Error("Selecione uma imagem ou um pictograma para o símbolo.");
  const categories = [...new Set(draft.categories)];
  if (categories.length < 1 || categories.length > 8 || !categories.every((category) => /^[a-z0-9][a-z0-9_-]{0,79}$/.test(category))) {
    throw new Error("Escolha de uma a oito categorias para o símbolo.");
  }
  if (previous && previous.crianca_id !== patientId) throw new Error("Selecione o paciente do símbolo antes de editar.");

  let staged: string | null = null;
  let result: { symbol: CustomSymbol; retired_path: string | null };
  try {
    if (draft.photo) {
      if (!draft.photoAuthorized) throw new Error("Confirme a autorização para usar esta foto no perfil selecionado.");
      if (!PHOTO_TYPES.has(draft.photo.type) || !draft.photo.size || draft.photo.size > MAX_PHOTO_BYTES) {
        throw new Error("A imagem precisa estar em JPEG, PNG ou WebP e ter até 2 MB depois do processamento.");
      }
      const reservation = await service.rpc("reserve_caa_symbol_image", { p_crianca_id: patientId, p_authorized: true });
      if (reservation.error || !reservation.data) throw boardError(reservation.error);
      staged = reservation.data;
      const { error } = await service.storage.from(PHOTO_BUCKET).upload(staged, draft.photo, {
        upsert: false, cacheControl: "0", contentType: draft.photo.type,
      });
      if (error) throw new Error("Não foi possível enviar a foto privada. Verifique sua conexão e tente novamente.");
    }
    const { data, error } = await service.rpc("save_caa_custom_symbol", {
      p_crianca_id: patientId,
      p_id: previous?.id ?? null,
      p_label: label,
      p_speech_text: speechText,
      p_categories: categories,
      p_arasaac_id: staged ? null : draft.arasaacId,
      p_image_path: staged ?? draft.imagePath,
      p_hidden: draft.hidden,
      p_expected_version: previous?.version ?? 0,
    }).single();
    if (error || !data) throw boardError(error);
    result = data;
  } catch (error) {
    if (staged) await retireStagedPhoto(patientId, staged);
    throw error;
  }
  return { symbol: result.symbol, cleanupPending: await cleanRetiredPhoto(result.retired_path) };
}

export function symbolDraft(symbol: CustomSymbol | null, defaultCategory: string): SymbolDraft {
  return {
    label: symbol?.label ?? "",
    speechText: symbol?.speech_text ?? "",
    categories: symbol?.categories ?? [defaultCategory],
    arasaacId: symbol?.arasaac_id ?? null,
    imagePath: symbol?.image_path ?? null,
    photo: null,
    photoAuthorized: false,
    hidden: symbol?.hidden ?? false,
  };
}

export async function deleteCustomSymbol(patientId: string, symbol: CustomSymbol) {
  const { data, error } = await client().rpc("delete_caa_custom_symbol", {
    p_crianca_id: patientId, p_id: symbol.id, p_expected_version: symbol.version,
  }).single();
  if (error || !data) throw boardError(error);
  return { cleanupPending: await cleanRetiredPhoto(data.retired_path) };
}

export async function saveCatalogOverride(patientId: string, symbolId: string, arasaacId: CatalogOverride["arasaac_id"] | null) {
  const { error } = await client().rpc("save_caa_catalog_override", {
    p_crianca_id: patientId, p_symbol_id: symbolId, p_arasaac_id: arasaacId,
  });
  if (error) throw boardError(error);
}

export async function retryBoardPhotoCleanup(patientId: string) {
  const { data, error } = await client().rpc("list_caa_symbol_image_cleanup", { p_crianca_id: patientId });
  if (error) throw boardError(error);
  if (!data?.length) return;
  const result = await client().storage.from(PHOTO_BUCKET).remove(data);
  if (result.error) throw new Error("A limpeza de fotos antigas precisa ser tentada novamente.");
}
