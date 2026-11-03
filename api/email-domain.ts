import { Resolver } from "node:dns/promises";

type DomainStatus = "valid" | "invalid" | "unknown";

const MAX_BODY_BYTES = 512;
const DNS_DEADLINE_MS = 2000;
const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const NON_PUBLIC_SUFFIX = /\.(?:arpa|example|internal|invalid|local|localhost|onion|test)$/;

function dnsCode(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function isMissingRecord(error: unknown) {
  const code = dnsCode(error);
  return code === "ENOTFOUND" || code === "ENODATA";
}

async function checkMailDomain(domain: string): Promise<DomainStatus> {
  if (NON_PUBLIC_SUFFIX.test(domain)) return "invalid";

  const resolver = new Resolver({ timeout: 1000, tries: 1 });
  const deadline = setTimeout(() => resolver.cancel(), DNS_DEADLINE_MS);

  try {
    const records = await resolver.resolveMx(domain).catch((error: unknown) => {
      if (dnsCode(error) === "ENODATA") return [];
      throw error;
    });

    if (records.some(({ exchange }) => exchange !== "" && exchange !== ".")) {
      return "valid";
    }
    if (records.length > 0) {
      // Node may represent the DNS root (a null MX target) as an empty string.
      return records.length === 1 && records[0].priority === 0
        ? "invalid"
        : "unknown";
    }

    // SMTP permits implicit MX via an address record when no MX is published.
    const addresses = await Promise.allSettled([
      resolver.resolve4(domain),
      resolver.resolve6(domain),
    ]);
    if (addresses.some((result) => result.status === "fulfilled" && result.value.length)) {
      return "valid";
    }
    return addresses.every(
      (result) => result.status === "fulfilled" || isMissingRecord(result.reason),
    )
      ? "invalid"
      : "unknown";
  } catch (error) {
    return dnsCode(error) === "ENOTFOUND" ? "invalid" : "unknown";
  } finally {
    clearTimeout(deadline);
  }
}

async function readDomain(request: Request): Promise<string | null> {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json" || !request.body) return null;
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    const data: unknown = JSON.parse(body + decoder.decode());
    if (
      !data ||
      typeof data !== "object" ||
      !("domain" in data) ||
      Object.keys(data).length !== 1 ||
      typeof data.domain !== "string"
    ) return null;
    const domain = data.domain.toLowerCase();
    return domain.length <= 253 && DOMAIN_PATTERN.test(domain) ? domain : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const headers = { "Cache-Control": "no-store" };
    if (request.method !== "POST") {
      return Response.json({ status: "unknown" }, {
        status: 405,
        headers: { ...headers, Allow: "POST" },
      });
    }
    const domain = await readDomain(request);
    if (domain === null) {
      return Response.json({ status: "unknown" }, { status: 400, headers });
    }
    return Response.json({ status: await checkMailDomain(domain) }, { headers });
  },
};
