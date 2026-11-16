import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const PHOTO_PATH = new RegExp("^" + UUID + "/" + UUID + "$");
const BUCKET = "caa-symbol-images";
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const NO_STORE = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function errorResponse(status: number) {
  return Response.json({ status: "unavailable" }, {
    status,
    headers: status === 405 ? { ...NO_STORE, Allow: "POST" } : NO_STORE,
  });
}

async function readBounded(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer;
}

function imageType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const startsWith = (value: string, offset = 0) =>
    [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  if (bytes[0] === 0x89 && startsWith("PNG\r\n\x1a\n", 1)) return "image/png";
  if (startsWith("RIFF") && startsWith("WEBP", 8)) return "image/webp";
  return null;
}

export async function boardPhotoResponse(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  if (request.method !== "POST") return errorResponse(405);
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [A-Za-z0-9_.-]{20,5000}$/.test(authorization))
    return errorResponse(401);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" ||
      Number(request.headers.get("content-length")) > 512) return errorResponse(400);

  let path: string;
  try {
    const input = await readBounded(request.body, 512);
    const payload: unknown = input && JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input));
    if (!payload || typeof payload !== "object" || !("path" in payload) ||
        typeof payload.path !== "string" || !PHOTO_PATH.test(payload.path)) {
      return errorResponse(400);
    }
    path = payload.path;
  } catch {
    return errorResponse(400);
  }

  const publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
  const serviceKey = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!publicKey || !serviceKey) return errorResponse(503);

  try {
    const url = new URL(env.VITE_SUPABASE_URL?.trim() ?? "");
    if (url.protocol !== "https:" || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return errorResponse(503);
    const metadata = new URL("/rest/v1/caa_custom_symbols", url);
    metadata.searchParams.set("select", "image_path");
    metadata.searchParams.set("crianca_id", "eq." + path.split("/")[0]);
    metadata.searchParams.set("image_path", "eq." + path);
    metadata.searchParams.set("limit", "1");

    // PostgREST evaluates the active patient's RLS against the caller's own JWT.
    const access = await fetch(metadata, {
      headers: { apikey: publicKey, Authorization: authorization, "Cache-Control": "no-store" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (access.status === 401) return errorResponse(401);
    if (access.status === 403) return errorResponse(404);
    if (!access.ok) return errorResponse(502);
    const rows: unknown = await access.json();
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.image_path !== path)
      return errorResponse(404);

    // The privileged request is reachable only after a fresh authorization check.
    const objectUrl = new URL("/storage/v1/object/authenticated/" + BUCKET + "/" + path, url);
    const image = await fetch(objectUrl, {
      headers: {
        apikey: serviceKey,
        ...(serviceKey.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + serviceKey }),
        "Cache-Control": "no-store",
      },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (image.status === 404) return errorResponse(404);
    if (!image.ok || Number(image.headers.get("content-length")) > MAX_PHOTO_BYTES)
      return errorResponse(502);

    const bytes = await readBounded(image.body, MAX_PHOTO_BYTES);
    const type = bytes && imageType(bytes);
    if (!bytes || !type) return errorResponse(502);

    return new Response(bytes, {
      headers: { ...NO_STORE, "Content-Type": type, "Content-Length": String(bytes.length) },
    });
  } catch {
    return errorResponse(502);
  }
}

export async function handleBoardPhoto(
  req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv = process.env,
) {
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "content-length"]) {
    const value = req.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  const mayHaveBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request("http://localhost/api/board-photo", {
    method: req.method, headers,
    ...(mayHaveBody ? { body: Readable.toWeb(req), duplex: "half" } : {}),
  } as RequestInit);
  const response = await boardPhotoResponse(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export default { fetch: (request: Request) => boardPhotoResponse(request) };
