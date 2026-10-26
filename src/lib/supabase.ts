import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

function validateConfiguration(): string | null {
  if (
    !url ||
    !key ||
    url.includes("SEU_PROJETO") ||
    key.includes("SUBSTITUA")
  ) {
    return "A conexão ainda não foi configurada. Você pode explorar a demonstração.";
  }
  try {
    if (new URL(url).protocol !== "https:")
      return "A conexão com o Supabase deve usar HTTPS.";
  } catch {
    return "O endereço do Supabase é inválido.";
  }
  // VITE_* is bundled into public JavaScript; privileged keys must be rejected.
  if (!key.startsWith("sb_publishable_")) {
    return "Informe uma chave pública publishable do Supabase.";
  }
  return null;
}

export const configurationError = validateConfiguration();

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const forwardAbort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", forwardAbort);
  }
}

export const supabase = configurationError
  ? null
  : createClient<Database>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        storageKey: "comunica-react-auth",
      },
      global: { fetch: fetchWithTimeout },
    });
