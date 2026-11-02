import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comunicacao } from "./database.types";
import {
  createInvitation,
  fetchPatientEvents,
  invitationMailto,
  listGuardianMembers,
  listProfessionalPatients,
  redeemInvitation,
  revokeMember,
  validateReportPeriod,
} from "./professional";

const mocked = vi.hoisted(() => ({
  client: { auth: { getUser: vi.fn() }, from: vi.fn(), rpc: vi.fn() },
}));
vi.mock("./supabase", () => ({ supabase: mocked.client }));

type Result = { data: unknown; error: unknown };
type Operation = { name: string; args: unknown[] };
let resolveQuery: (query: Query) => Result | Promise<Result>;
let queries: Query[];

class Query implements PromiseLike<Result> {
  operations: Operation[] = [];
  constructor(readonly source: string, readonly parameters?: Record<string, unknown>) {
    queries.push(this);
  }
  op(name: string, ...args: unknown[]) { this.operations.push({ name, args }); return this; }
  select(...args: unknown[]) { return this.op("select", ...args); }
  eq(...args: unknown[]) { return this.op("eq", ...args); }
  gt(...args: unknown[]) { return this.op("gt", ...args); }
  gte(...args: unknown[]) { return this.op("gte", ...args); }
  lt(...args: unknown[]) { return this.op("lt", ...args); }
  lte(...args: unknown[]) { return this.op("lte", ...args); }
  in(...args: unknown[]) { return this.op("in", ...args); }
  order(...args: unknown[]) { return this.op("order", ...args); }
  limit(...args: unknown[]) { return this.op("limit", ...args); }
  or(...args: unknown[]) { return this.op("or", ...args); }
  abortSignal(...args: unknown[]) { return this.op("abortSignal", ...args); }
  single() { return this.op("single"); }
  maybeSingle() { return this.op("maybeSingle"); }
  args(name: string) { return this.operations.find((operation) => operation.name === name)?.args; }
  then<TResult1 = Result, TResult2 = never>(
    fulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => resolveQuery(this)).then(fulfilled, rejected);
  }
}

const CHILD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFESSIONAL = "33333333-3333-4333-8333-333333333333";
const OWNER = "11111111-1111-4111-8111-111111111111";
const PERIOD = { from: "2026-03-01", to: "2026-03-31" };
const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const result = (data: unknown): Result => ({ data, error: null });
const event = (index: number): Comunicacao => ({
  id: uuid(index + 1), usuario_id: OWNER, crianca_id: CHILD,
  pictograma_id: "agua", rotulo: "Água", categoria: "Necessidades",
  created_at: new Date(Date.UTC(2026, 2, 20, 12) - index * 1000).toISOString(),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T15:00:00.000Z"));
  queries = [];
  mocked.client.auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: PROFESSIONAL } }, error: null });
  mocked.client.from.mockReset().mockImplementation((name: string) => new Query(name));
  mocked.client.rpc.mockReset().mockImplementation((name: string, parameters: Record<string, unknown>) => new Query(`rpc:${name}`, parameters));
  resolveQuery = (query) => { throw new Error(`Unexpected query: ${query.source}`); };
});
afterEach(() => { vi.useRealTimers(); });

describe("professional service: invitation boundaries", () => {
  it("uses the owner RPC without letting the client choose code, timestamps or permissions", async () => {
    const invitation = { id: uuid(10), crianca_id: CHILD, code: "000042", expires_at: "2026-11-03T15:00:00Z", is_used: false, created_at: "2026-11-02T15:00:00Z" };
    resolveQuery = () => result(invitation);
    await expect(createInvitation(CHILD)).resolves.toEqual(invitation);
    expect(mocked.client.rpc).toHaveBeenCalledExactlyOnceWith("create_caa_invitation", { p_crianca_id: CHILD });
    expect(queries[0].args("single")).toEqual([]);
    expect(mocked.client.from).not.toHaveBeenCalled();
  });

  it("builds an encoded mailto containing only the invitation code and generic instructions", () => {
    const uri = invitationMailto("000042", "2026-11-03T15:00:00Z");
    expect(uri.startsWith("mailto:?subject=")).toBe(true);
    expect(uri).not.toContain("\n");
    const parameters = new URLSearchParams(uri.slice("mailto:?".length));
    expect([...parameters.keys()]).toEqual(["subject", "body"]);
    expect(parameters.get("subject")).toContain("Comunica");
    expect(parameters.get("body")).toContain("Código de vínculo: 000042");
    expect(parameters.get("body")).toContain("uma única vez");
    expect(uri).not.toContain(CHILD);
    expect(uri).not.toContain(OWNER);
    expect(uri).not.toContain(PROFESSIONAL);
    expect(() => invitationMailto("12345", "2026-11-03T15:00:00Z")).toThrow("convite não está disponível");
    expect(() => invitationMailto("000042", "not-a-date")).toThrow("convite não está disponível");
  });

  it.each(["", "12345", "1234567", "12e345", " 123456", "123456\n", "１２３４５６"])("rejects malformed code %j before calling any RPC", async (code) => {
    await expect(redeemInvitation(code)).rejects.toThrow("seis dígitos");
    expect(mocked.client.rpc).not.toHaveBeenCalled();
  });

  it.each(["linked", "already_linked"])("accepts the server status %s and preserves leading zeros", async (status) => {
    resolveQuery = () => result({ status, crianca_id: CHILD, retry_after_seconds: 0 });
    await expect(redeemInvitation("000042")).resolves.toBeUndefined();
    expect(mocked.client.rpc).toHaveBeenCalledExactlyOnceWith("redeem_caa_invitation", { p_code: "000042" });
    expect(mocked.client.from).not.toHaveBeenCalled();
  });

  it("uses a generic invalid message and the server cooldown without leaking diagnostics", async () => {
    resolveQuery = () => result({ status: "invalid", crianca_id: null, retry_after_seconds: 0 });
    await expect(redeemInvitation("123456")).rejects.toThrow("inválido, expirado ou já utilizado");
    resolveQuery = () => result({ status: "rate_limited", crianca_id: null, retry_after_seconds: 121 });
    await expect(redeemInvitation("123456")).rejects.toThrow("Aguarde 3 minuto(s)");
    resolveQuery = () => ({ data: null, error: { message: "private database diagnostic" } });
    await expect(redeemInvitation("123456")).rejects.toThrow("Não foi possível acessar os dados");
  });

  it("lists and revokes only the explicitly selected child and professional", async () => {
    const controller = new AbortController();
    const members = [{ professional_id: PROFESSIONAL, professional_name: "Profissional fictício", created_at: "2026-11-02T15:00:00Z" }];
    resolveQuery = (query) => result(query.source === "rpc:list_caa_members" ? members : true);
    await expect(listGuardianMembers(CHILD, controller.signal)).resolves.toEqual(members);
    expect(queries[0].args("abortSignal")).toEqual([controller.signal]);
    await revokeMember(CHILD, PROFESSIONAL);
    expect(mocked.client.rpc).toHaveBeenLastCalledWith("revoke_caa_member", { p_crianca_id: CHILD, p_professional_id: PROFESSIONAL });
    await expect(revokeMember("not-a-patient", PROFESSIONAL)).rejects.toThrow("perfil válido");
  });
});

describe("professional service: complete scoped reports", () => {
  it("loads more than 500 events using a stable patient-scoped cursor and rechecks access", async () => {
    const records = Array.from({ length: 601 }, (_, index) => event(index));
    let membershipChecks = 0;
    let pages = 0;
    resolveQuery = (query) => {
      if (query.source === "caa_members") { membershipChecks++; return result({ id: uuid(9999) }); }
      if (query.source === "caa_events") return result([records.slice(0, 500), records.slice(500), []][pages++] ?? []);
      throw new Error("Unexpected relation");
    };
    await expect(fetchPatientEvents(CHILD, PERIOD)).resolves.toEqual(records);
    expect(membershipChecks).toBe(2);
    const eventQueries = queries.filter((query) => query.source === "caa_events");
    expect(eventQueries).toHaveLength(3);
    for (const query of eventQueries) {
      expect(query.args("eq")).toEqual(["crianca_id", CHILD]);
      expect(query.args("gte")).toEqual(["created_at", "2026-03-01T00:00:00-03:00"]);
      expect(query.args("lt")).toEqual(["created_at", "2026-04-01T00:00:00-03:00"]);
      expect(query.args("lte")).toEqual(["created_at", "2026-11-02T15:00:00.000Z"]);
      expect(query.args("limit")).toEqual([500]);
      expect(query.operations.filter((operation) => operation.name === "order").map((operation) => operation.args)).toEqual([
        ["created_at", { ascending: false }], ["id", { ascending: false }],
      ]);
    }
    expect(eventQueries[0].args("or")).toBeUndefined();
    expect(eventQueries[1].args("or")).toEqual([
      `created_at.lt.${records[499].created_at},and(created_at.eq.${records[499].created_at},id.lt.${records[499].id})`,
    ]);
    expect(eventQueries[2].args("or")).toEqual([
      `created_at.lt.${records[600].created_at},and(created_at.eq.${records[600].created_at},id.lt.${records[600].id})`,
    ]);
  });

  it("continues to an explicit empty page when the server returns fewer rows than requested", async () => {
    const records = [event(0), event(1), event(2)];
    let pages = 0;
    resolveQuery = (query) => query.source === "caa_members" ? result({ id: uuid(9999) }) :
      result([records.slice(0, 2), records.slice(2), []][pages++] ?? []);
    await expect(fetchPatientEvents(CHILD, PERIOD)).resolves.toEqual(records);
    expect(pages).toBe(3);
    expect(queries.filter((query) => query.source === "caa_events").every((query) => query.args("limit")?.[0] === 500)).toBe(true);
  });

  it("does not silently truncate at 10,000 records", async () => {
    let page = 0;
    resolveQuery = (query) => query.source === "caa_members" ? result({ id: uuid(9999) }) :
      result(Array.from({ length: page < 20 ? 500 : 1 }, (_, offset) => event(page * 500 + offset)));
    const original = resolveQuery;
    resolveQuery = (query) => { const response = original(query); if (query.source === "caa_events") page++; return response; };
    await expect(fetchPatientEvents(CHILD, PERIOD)).rejects.toThrow("mais de 10.000 registros");
    expect(page).toBe(21);
  });

  it("discards results if the professional link was revoked during the request", async () => {
    let membershipChecks = 0;
    let pages = 0;
    resolveQuery = (query) => query.source === "caa_members" ? result(++membershipChecks === 1 ? { id: uuid(9999) } : null) : result(pages++ === 0 ? [event(0)] : []);
    await expect(fetchPatientEvents(CHILD, PERIOD)).rejects.toThrow("vínculo com este paciente não está disponível");
    expect(membershipChecks).toBe(2);
    expect(queries.filter((query) => query.source === "caa_events")).toHaveLength(2);
  });

  it("does not query events without a link, or accept rows belonging to another child", async () => {
    resolveQuery = () => result(null);
    await expect(fetchPatientEvents(CHILD, PERIOD)).rejects.toThrow("vínculo");
    expect(mocked.client.from.mock.calls.map(([source]) => source)).toEqual(["caa_members"]);
    resolveQuery = (query) => result(query.source === "caa_members" ? { id: uuid(9999) } : [{ ...event(0), crianca_id: uuid(777) }]);
    await expect(fetchPatientEvents(CHILD, PERIOD)).rejects.toThrow("Não foi possível acessar os dados");
  });

  it("passes abort signals and prevents an aborted response from reaching the PDF flow", async () => {
    const controller = new AbortController();
    resolveQuery = (query) => {
      if (query.source === "caa_events") { controller.abort(); return result([event(0)]); }
      return result({ id: uuid(9999) });
    };
    await expect(fetchPatientEvents(CHILD, PERIOD, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(queries.every((query) => query.args("abortSignal")?.[0] === controller.signal)).toBe(true);
    expect(queries.filter((query) => query.source === "caa_members")).toHaveLength(1);
  });

  it("does not start authentication or data requests for a pre-aborted operation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(fetchPatientEvents(CHILD, PERIOD, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(listProfessionalPatients(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocked.client.auth.getUser).not.toHaveBeenCalled();
    expect(mocked.client.from).not.toHaveBeenCalled();
  });

  it("reports expired authentication instead of querying patient data", async () => {
    mocked.client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(fetchPatientEvents(CHILD, PERIOD)).rejects.toThrow("sessão expirou");
    expect(mocked.client.from).not.toHaveBeenCalled();
  });

  it("paginates patient memberships and child batches beyond 500 patients", async () => {
    const ids = Array.from({ length: 601 }, (_, index) => uuid(index + 1));
    let memberPages = 0;
    resolveQuery = (query) => {
      if (query.source === "caa_members") return result(([ids.slice(0, 500), ids.slice(500), []][memberPages++] ?? []).map((crianca_id) => ({ crianca_id })));
      const batch = query.args("in")?.[1] as string[];
      const after = query.args("gt")?.[1] as string | undefined;
      return result(batch.filter((id) => !after || id > after).map((id) => ({ id, usuario_id: OWNER, nome: `Paciente ${id.slice(-4)}`, created_at: "2026-03-01T00:00:00Z", updated_at: "2026-03-01T00:00:00Z" })));
    };
    const patients = await listProfessionalPatients();
    expect(patients).toHaveLength(601);
    const membershipQueries = queries.filter((query) => query.source === "caa_members");
    expect(membershipQueries).toHaveLength(3);
    expect(membershipQueries[1].args("gt")).toEqual(["crianca_id", ids[499]]);
    expect(membershipQueries[2].args("gt")).toEqual(["crianca_id", ids[600]]);
    expect(membershipQueries.every((query) => query.args("eq")?.[1] === PROFESSIONAL)).toBe(true);
    expect([...new Set(queries.filter((query) => query.source === "criancas").map((query) => (query.args("in")?.[1] as string[]).length))]).toEqual([500, 101]);
  });

  it("loads all patients when both membership and child queries are capped below 500", async () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    const counts = { caa_members: 0, criancas: 0 };
    resolveQuery = (query) => {
      const after = query.args("gt")?.[1] as string | undefined;
      const selected = query.source === "criancas" ? query.args("in")?.[1] as string[] : ids;
      const rows = selected.filter((id) => !after || id > after).slice(0, 2);
      if (query.source === "caa_members") {
        counts.caa_members++;
        return result(rows.map((crianca_id) => ({ crianca_id })));
      }
      counts.criancas++;
      return result(rows.map((id) => ({ id, usuario_id: OWNER, nome: `Paciente ${id.slice(-1)}`, created_at: "2026-03-01T00:00:00Z", updated_at: "2026-03-01T00:00:00Z" })));
    };
    expect((await listProfessionalPatients()).map((patient) => patient.id)).toEqual(ids);
    expect(counts).toEqual({ caa_members: 3, criancas: 3 });
  });

  it("fails rather than looping or exporting partial results when a server ignores the cursor", async () => {
    resolveQuery = (query) => query.source === "caa_members" ? result({ id: uuid(9999) }) : result([event(0)]);
    await expect(fetchPatientEvents(CHILD, PERIOD)).rejects.toThrow("Não foi possível acessar os dados");
    expect(queries.filter((query) => query.source === "caa_events")).toHaveLength(2);
    queries = [];
    resolveQuery = () => result([{ crianca_id: uuid(1) }]);
    await expect(listProfessionalPatients()).rejects.toThrow("Não foi possível acessar os dados");
    expect(queries).toHaveLength(2);
  });
});

describe("report calendar validation", () => {
  it("supports leap dates and inclusive calendar days in Brasília", () => {
    expect(validateReportPeriod({ from: "2024-02-29", to: "2024-02-29" })).toEqual({
      start: "2024-02-29T00:00:00-03:00", end: "2024-03-01T00:00:00-03:00",
    });
    expect(validateReportPeriod({ from: "2024-01-01", to: "2024-12-31" }).end).toBe("2025-01-01T00:00:00-03:00");
  });

  it.each([
    { from: "2026-02-29", to: "2026-03-01" },
    { from: "2026-03-31", to: "2026-03-01" },
    { from: "2019-12-31", to: "2020-01-01" },
    { from: "2026-03-01T00:00:00Z", to: "2026-03-31" },
    { from: "2024-01-01", to: "2025-01-01" },
    { from: "2026-11-02", to: "2026-11-03" },
    { from: "9999-12-30", to: "9999-12-31" },
  ])("rejects invalid report period %j before any network request", async (period) => {
    expect(() => validateReportPeriod(period)).toThrow();
    await expect(fetchPatientEvents(CHILD, period)).rejects.toThrow();
    expect(mocked.client.auth.getUser).not.toHaveBeenCalled();
    expect(mocked.client.from).not.toHaveBeenCalled();
  });
});
