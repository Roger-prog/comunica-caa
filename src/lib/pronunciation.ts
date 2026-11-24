import type { Database } from "./database.types";
import { supabase } from "./supabase";

type Functions = Database["public"]["Functions"];
export type Recording = Functions["list_caa_pronunciation"]["Returns"][number];
export type RecordingAccess = Functions["list_caa_pronunciation_access"]["Returns"][number];
export type RecordingSettings = Functions["get_caa_pronunciation_settings"]["Returns"][number];
export type RecordingNote = Functions["list_caa_pronunciation_notes"]["Returns"][number];
export type RecordingDraft = { id: string; practice: string; audio: Blob };

export const maxRecordingBytes = 2 * 1024 * 1024;
export const audioTypes = ["audio/webm", "audio/mp4", "audio/ogg"];
const PAGE_SIZE = 50;

function client() {
  if (!supabase) throw new Error("A conexão para gravações está indisponível.");
  return supabase;
}

function errorMessage(action: string, code?: string) {
  if (code === "42501") return new Error("A permissão para acessar esta gravação não está disponível.");
  return new Error(`Não foi possível ${action}. Tente novamente.`);
}

export async function getRecordingSettings(patientId: string, signal: AbortSignal) {
  const { data, error } = await client().rpc("get_caa_pronunciation_settings", { p_crianca_id: patientId })
    .abortSignal(signal).single();
  if (error) throw errorMessage("carregar os ajustes de gravação", error.code);
  return data;
}

export async function loadRecordingAccess(patientId: string, signal: AbortSignal) {
  const { data, error } = await client().rpc("list_caa_pronunciation_access", { p_crianca_id: patientId })
    .abortSignal(signal);
  if (error) throw errorMessage("listar os profissionais autorizados", error.code);
  return data;
}

export async function saveRecordingAccess(patientId: string, access: RecordingAccess) {
  const { error } = await client().rpc("set_caa_pronunciation_access", {
    p_crianca_id: patientId,
    p_professional_id: access.professional_id,
    p_can_listen: access.can_listen,
    p_can_observe: access.can_observe,
  });
  if (error) throw errorMessage("atualizar a autorização", error.code);
}

export async function setRetention(patientId: string, days: number) {
  const { error } = await client().rpc("set_caa_pronunciation_retention", { p_crianca_id: patientId, p_days: days });
  if (error) throw errorMessage("alterar o prazo de retenção", error.code);
}

function encodeClip(audio: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(errorMessage("preparar o áudio"));
    reader.readAsDataURL(audio);
  });
}

export async function saveRecording(patientId: string, draft: RecordingDraft, authorized: boolean) {
  const { data, error } = await client().rpc("save_caa_pronunciation", {
    p_crianca_id: patientId,
    p_id: draft.id,
    p_practice: draft.practice,
    p_content_type: draft.audio.type.split(";")[0],
    p_audio_base64: await encodeClip(draft.audio),
    p_authorized: authorized,
  });
  if (error || data !== draft.id) throw errorMessage("salvar a gravação", error?.code);
}

export async function listRecordings(patientId: string, cursor: Recording | undefined, signal: AbortSignal) {
  const { data, error } = await client().rpc("list_caa_pronunciation", {
    p_crianca_id: patientId,
    p_before_time: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
  }).abortSignal(signal);
  if (error) throw errorMessage("listar as gravações", error.code);
  return { items: data.slice(0, PAGE_SIZE), hasOlder: data.length > PAGE_SIZE };
}

export async function fetchRecordingAudio(id: string, signal: AbortSignal) {
  const { data, error } = await client().rpc("get_caa_pronunciation_audio", { p_id: id }).abortSignal(signal).single();
  if (error) throw errorMessage("carregar o áudio", error.code);
  const contents = Uint8Array.from(atob(data.audio_base64), (code) => code.charCodeAt(0));
  return new Blob([contents], { type: data.mime_type });
}

export async function listRecordingNotes(id: string, signal: AbortSignal) {
  const { data, error } = await client().rpc("list_caa_pronunciation_notes", { p_id: id }).abortSignal(signal);
  if (error) throw errorMessage("consultar as observações", error.code);
  return data;
}

export async function saveRecordingNote(id: string, observation: string) {
  const { error } = await client().rpc("save_caa_pronunciation_note", { p_id: id, p_observation: observation });
  if (error) throw errorMessage("salvar a observação", error.code);
}

export async function deleteRecording(id: string) {
  const { error } = await client().rpc("delete_caa_pronunciation", { p_id: id });
  if (error) throw errorMessage("excluir a gravação", error.code);
}
