import { getArasaacImageUrl, isArasaacId } from "./arasaacPaths";
import { resolveArasaacPublicTerm } from "./arasaacVocabulary";

export {
  ARASAAC_CREDITS, ARASAAC_LICENSE_URL, ARASAAC_TERMS_URL,
  getArasaacImageUrl, getOfficialArasaacImageUrl,
} from "./arasaacPaths";
export { getArasaacPublicTerms } from "./arasaacVocabulary";

export interface ArasaacResult {
  id: number;
  labels: string[];
  imageUrl: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED_TERMS = 64;
const MAX_RESULTS = 48;

const cache = new Map<string, { expiresAt: number; results: ArasaacResult[] }>();
const inProgress = new Map<string, Promise<ArasaacResult[]>>();

function decodeResults(data: unknown): ArasaacResult[] {
  if (!Array.isArray(data) || data.length > MAX_RESULTS) {
    throw new Error("A resposta do catálogo de pictogramas é inválida.");
  }
  return data.flatMap((entry) => {
    if (!entry || !isArasaacId(entry.id) || !Array.isArray(entry.labels)) return [];
    return [{
      id: entry.id,
      labels: entry.labels.filter((label: unknown): label is string =>
        typeof label === "string" && label.trim().length > 0 && label.length <= 100,
      ).slice(0, 8),
      imageUrl: getArasaacImageUrl(entry.id),
    }];
  });
}

async function loadResults(term: string): Promise<ArasaacResult[]> {
  try {
    const query = new URLSearchParams({ q: term });
    const response = await fetch(`/api/arasaac-search?${query}`, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8500),
    });
    if (!response.ok) throw new Error("upstream_unavailable");

    const results = decodeResults(await response.json());
    cache.delete(term);
    cache.set(term, { expiresAt: Date.now() + CACHE_TTL_MS, results });
    while (cache.size > MAX_CACHED_TERMS) cache.delete(cache.keys().next().value!);
    return results;
  } catch {
    throw new Error("Não foi possível consultar o ARASAAC. Verifique a conexão e tente novamente.");
  }
}

function withAbort<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void request.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export async function searchArasaac(
  term: string,
  options: { signal?: AbortSignal } = {},
): Promise<ArasaacResult[]> {
  options.signal?.throwIfAborted();
  const publicTerm = resolveArasaacPublicTerm(term);
  if (!publicTerm) throw new Error("Selecione um termo do vocabulário público para pesquisar.");

  const found = cache.get(publicTerm);
  if (found && found.expiresAt > Date.now()) return found.results;
  if (found) cache.delete(publicTerm);

  let pending = inProgress.get(publicTerm);
  if (!pending) {
    pending = loadResults(publicTerm).finally(() => inProgress.delete(publicTerm));
    inProgress.set(publicTerm, pending);
  }
  return withAbort(pending, options.signal);
}
