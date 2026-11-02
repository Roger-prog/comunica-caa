import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { isMockAuthMode } from "../auth/authMode";
import { assertPasswordUpdateToken } from "../auth/passwordMutation";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
const key = publishableKey || anonKey;
const keySource = publishableKey
  ? "VITE_SUPABASE_PUBLISHABLE_KEY"
  : anonKey
    ? "VITE_SUPABASE_ANON_KEY"
    : null;

type ConfigurationFailure = { code: string; message: string };

function isPublicKey(value: string): boolean {
  if (
    value.startsWith("sb_publishable_") &&
    value.length > "sb_publishable_".length &&
    !/\s/.test(value)
  )
    return true;
  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
  )
    return false;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded: unknown = JSON.parse(
      atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")),
    );
    // Only a configuration check: the Supabase server validates the signature.
    return (
      decoded !== null &&
      typeof decoded === "object" &&
      !Array.isArray(decoded) &&
      (decoded as { role?: unknown }).role === "anon"
    );
  } catch {
    return false;
  }
}

function validateConfiguration(): ConfigurationFailure | null {
  if (!url || url.includes("SEU_PROJETO")) {
    return {
      code: "missing_url",
      message: "Configure VITE_SUPABASE_URL para habilitar o acesso à conta.",
    };
  }
  if (!key || key.includes("SUBSTITUA")) {
    return {
      code: "missing_key",
      message:
        "Configure VITE_SUPABASE_PUBLISHABLE_KEY ou VITE_SUPABASE_ANON_KEY com uma chave pública do Supabase.",
    };
  }
  try {
    if (new URL(url).protocol !== "https:") {
      return {
        code: "invalid_url",
        message: "A conexão com o Supabase deve usar um endereço HTTPS válido.",
      };
    }
  } catch {
    return {
      code: "invalid_url",
      message: "O endereço do Supabase é inválido.",
    };
  }
  // VITE_* is public in the browser: never accept secret or service_role keys.
  if (!isPublicKey(key)) {
    return {
      code: "invalid_key",
      message:
        "Informe uma chave pública publishable ou anon válida do Supabase. Chaves privilegiadas não podem ser usadas no navegador.",
    };
  }
  return null;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  assertPasswordUpdateToken(input, init);
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

function initializeSupabase() {
  const prefix = "[Comunica/Supabase]";
  console.log(`${prefix} Configuração do build`, {
    diagnosticVersion: 1,
    mode: import.meta.env.MODE,
    urlDefined: Boolean(url),
    publishableKeyDefined: Boolean(publishableKey),
    anonKeyDefined: Boolean(anonKey),
    keySource,
  });
  if (isMockAuthMode()) {
    console.log(`${prefix} Inicialização`, { status: "demo_mode" });
    return { client: null, error: null };
  }
  try {
    const failure = validateConfiguration();
    if (failure) {
      console.error(`${prefix} Configuração inválida`, {
        status: failure.code,
      });
      return { client: null, error: failure.message };
    }
    const client = createClient<Database>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        storageKey: "comunica-react-auth",
      },
      global: { fetch: fetchWithTimeout },
    });
    console.log(`${prefix} Inicialização`, { status: "initialized" });
    return { client, error: null };
  } catch {
    // Do not log the SDK error: it may contain the URL, API key or a token.
    console.error(`${prefix} Falha ao inicializar`, {
      status: "initialization_failed",
    });
    return {
      client: null,
      error:
        "Não foi possível inicializar a conexão com o Supabase. Verifique a configuração do site.",
    };
  }
}

const initialization = initializeSupabase();
export const supabase = initialization.client;
export const configurationError = initialization.error;
