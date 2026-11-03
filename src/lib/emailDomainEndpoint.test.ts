// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import endpoint from "../../api/email-domain";

const resolver = vi.hoisted(() => ({
  resolveMx: vi.fn(),
  resolve4: vi.fn(),
  resolve6: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolveMx = resolver.resolveMx;
    resolve4 = resolver.resolve4;
    resolve6 = resolver.resolve6;
    cancel = resolver.cancel;
  },
}));

const url = "https://example.org/api/email-domain";
const dnsError = (code: string) => Object.assign(new Error(), { code });

function check(domain: string) {
  return endpoint.fetch(new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  }));
}

describe("email domain endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects addresses and oversized request bodies without doing a DNS lookup", async () => {
    for (const domain of ["pessoa@mail.example.org", "a".repeat(600)]) {
      const response = await check(domain);
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(resolver.resolveMx).not.toHaveBeenCalled();
  });

  it("returns valid for a domain with a mail exchanger", async () => {
    resolver.resolveMx.mockResolvedValue([{ exchange: "mx.example.org", priority: 10 }]);
    expect(await (await check("MAIL.Example.ORG")).json()).toEqual({ status: "valid" });
    expect(resolver.resolveMx).toHaveBeenCalledWith("mail.example.org");
    expect(resolver.resolve4).not.toHaveBeenCalled();
  });

  it.each(["", "."])("rejects a null MX with exchange %j even without checking A or AAAA", async (exchange) => {
    resolver.resolveMx.mockResolvedValue([{ exchange, priority: 0 }]);
    expect(await (await check("no-mail.example.org")).json()).toEqual({ status: "invalid" });
    expect(resolver.resolve4).not.toHaveBeenCalled();
    expect(resolver.resolve6).not.toHaveBeenCalled();
  });

  it("rejects NXDOMAIN but treats a transient MX failure as unknown", async () => {
    resolver.resolveMx.mockRejectedValueOnce(dnsError("ENOTFOUND"));
    resolver.resolveMx.mockRejectedValueOnce(dnsError("ESERVFAIL"));
    expect(await (await check("mx.example.org")).json()).toEqual({ status: "invalid" });
    expect(await (await check("mx.example.org")).json()).toEqual({ status: "unknown" });
    expect(resolver.resolve4).not.toHaveBeenCalled();
  });

  it("checks for implicit MX and rejects only when no address record exists", async () => {
    resolver.resolveMx.mockRejectedValue(dnsError("ENODATA"));
    resolver.resolve4.mockRejectedValue(dnsError("ENODATA"));
    resolver.resolve6.mockResolvedValueOnce(["2001:db8::1"]);
    resolver.resolve6.mockRejectedValueOnce(dnsError("ENODATA"));
    resolver.resolve6.mockRejectedValueOnce(dnsError("ETIMEOUT"));
    expect(await (await check("mail.example.org")).json()).toEqual({ status: "valid" });
    expect(await (await check("mail.example.org")).json()).toEqual({ status: "invalid" });
    expect(await (await check("mail.example.org")).json()).toEqual({ status: "unknown" });
  });
});
