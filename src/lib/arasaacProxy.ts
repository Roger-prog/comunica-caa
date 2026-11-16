import { getOfficialArasaacImageUrl, isArasaacId } from "./arasaacPaths.ts";
import { resolveArasaacPublicTerm } from "./arasaacVocabulary.ts";

const API = "https://api.arasaac.org/v1/pictograms/pt/search/";
const MAX_RESULTS = 48;
const MAX_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const responseCache = {
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=43200",
};
const imageCache = {
  "Cache-Control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400",
};

function fail(status: number) {
  return Response.json({ error: "arasaac_unavailable" }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(status === 405 ? { Allow: "GET" } : {}),
    },
  });
}

async function fetchPublicAsset(url: string, accept: string): Promise<Response> {
  return fetch(url, {
    method: "GET",
    headers: { Accept: accept },
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(6500),
  });
}

async function readBounded(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body || Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("invalid_body_size");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error("invalid_body_size");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validJsonType(response: Response) {
  return response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json";
}

export async function handleArasaacSearch(request: Request): Promise<Response> {
  if (request.method !== "GET") return fail(405);
  const params = new URL(request.url).searchParams;
  const term = resolveArasaacPublicTerm(params.get("q") ?? "");
  if (!term || [...params].length !== 1) return fail(400);

  try {
    const upstream = await fetchPublicAsset(API + encodeURIComponent(term), "application/json");
    if (upstream.status === 404 && validJsonType(upstream)) {
      // The official endpoint uses 404 with [] for an empty result set.
      await upstream.body?.cancel();
      return Response.json([], { headers: responseCache });
    }
    if (!upstream.ok || !validJsonType(upstream)) {
      await upstream.body?.cancel();
      return fail(502);
    }

    const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBounded(upstream)));
    if (!Array.isArray(data)) return fail(502);
    const results = new Map<number, { id: number; labels: string[] }>();
    for (const item of data) {
      if (results.size >= MAX_RESULTS) break;
      if (!item || !isArasaacId(item._id) || item.violence === true || results.has(item._id)) continue;
      const labels: string[] = [];
      if (Array.isArray(item.keywords)) {
        for (const keyword of item.keywords) {
          if (labels.length >= 8) break;
          const label = keyword?.keyword;
          if (typeof label === "string" && label.trim() && label.length <= 100 && !labels.includes(label)) {
            labels.push(label);
          }
        }
      }
      results.set(item._id, { id: item._id, labels: labels.length ? labels : [term] });
    }
    return Response.json([...results.values()], { headers: responseCache });
  } catch {
    return fail(502);
  }
}

export async function handleArasaacImage(request: Request): Promise<Response> {
  if (request.method !== "GET") return fail(405);
  const params = new URL(request.url).searchParams;
  const rawId = params.get("id") ?? "";
  const id = Number(rawId);
  if (!/^[1-9][0-9]{0,9}$/.test(rawId) || !isArasaacId(id) || [...params].length !== 1) return fail(400);

  try {
    const upstream = await fetchPublicAsset(getOfficialArasaacImageUrl(id), "image/png");
    if (!upstream.ok || upstream.headers.get("content-type")?.split(";")[0].trim() !== "image/png") {
      await upstream.body?.cancel();
      return fail(upstream.status === 404 ? 404 : 502);
    }
    const bytes = await readBounded(upstream);
    if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return fail(502);
    return new Response(bytes, {
      headers: {
        ...imageCache,
        "Content-Type": "image/png",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return fail(502);
  }
}
