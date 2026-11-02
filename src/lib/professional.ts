import { supabase } from "./supabase";
import type {
  CaaInvitation,
  Comunicacao,
  Crianca,
  ProfessionalMember,
} from "./database.types";

export class ProfessionalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfessionalError";
  }
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVENTS = 10_000;
const PAGE_SIZE = 500;
const numericCode = (code: string) =>
  code.length === 6 && /^[0-9]+$/.test(code);
const FIELDS =
  "id,usuario_id,crianca_id,pictograma_id,rotulo,categoria,created_at";
const generic = () =>
  new ProfessionalError(
    "Não foi possível acessar os dados. Verifique sua conexão e tente novamente.",
  );
function client() {
  if (!supabase)
    throw new ProfessionalError(
      "Entre em uma conta conectada para utilizar este recurso.",
    );
  return supabase;
}
function patientId(value: string) {
  if (!UUID.test(value))
    throw new ProfessionalError("Selecione um perfil válido.");
}
function aborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Operação cancelada", "AbortError");
}
async function userId() {
  const { data, error } = await client().auth.getUser();
  if (error || !data.user)
    throw new ProfessionalError("Sua sessão expirou. Entre novamente.");
  return data.user.id;
}

export function validateReportPeriod(period: { from: string; to: string }) {
  const valid = (day: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day &&
    day >= "2020-01-01";
  if (!valid(period.from) || !valid(period.to) || period.from > period.to)
    throw new ProfessionalError("Informe um período válido a partir de 2020.");
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (period.to > today)
    throw new ProfessionalError("Selecione um período até a data atual.");
  const days =
    (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000 + 1;
  if (days > 366)
    throw new ProfessionalError("Selecione um período de até 366 dias.");
  const next = new Date(Date.parse(period.to) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    start: `${period.from}T00:00:00-03:00`,
    end: `${next}T00:00:00-03:00`,
  };
}

export function invitationMailto(code: string, expiresAt: string): string {
  if (!numericCode(code) || !Number.isFinite(Date.parse(expiresAt)))
    throw new ProfessionalError("O convite não está disponível.");
  const expiration = new Date(expiresAt).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const subject = "Convite para acompanhamento no Comunica - CAA";
  // Do not put patient names, medical information or account identifiers in email.
  const body = `Olá!\n\nConvido você a acompanhar um perfil no Comunica - CAA.\n\nCódigo de vínculo: ${code}\nVálido até ${expiration} (horário de Brasília).\n\nEntre no Comunica, abra Profissional e informe o código de seis dígitos. O convite permite consultar o histórico e gerar relatórios, e pode ser utilizado uma única vez.\n`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function createInvitation(id: string): Promise<CaaInvitation> {
  patientId(id);
  const { data, error } = await client()
    .rpc("create_caa_invitation", { p_crianca_id: id })
    .single();
  if (error || !data || !numericCode(data.code)) throw generic();
  return data;
}

export async function listGuardianMembers(
  id: string,
  signal?: AbortSignal,
): Promise<ProfessionalMember[]> {
  patientId(id);
  aborted(signal);
  let query = client().rpc("list_caa_members", { p_crianca_id: id });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  aborted(signal);
  if (error) throw generic();
  return data ?? [];
}

export async function revokeMember(
  id: string,
  professionalId: string,
): Promise<void> {
  patientId(id);
  patientId(professionalId);
  const { error } = await client().rpc("revoke_caa_member", {
    p_crianca_id: id,
    p_professional_id: professionalId,
  });
  if (error) throw generic();
}

export async function redeemInvitation(code: string): Promise<void> {
  if (!numericCode(code))
    throw new ProfessionalError("Informe os seis dígitos do convite.");
  const { data, error } = await client()
    .rpc("redeem_caa_invitation", { p_code: code })
    .single();
  if (error || !data) throw generic();
  if (data.status === "rate_limited") {
    const minutes = Math.max(1, Math.ceil(data.retry_after_seconds / 60));
    throw new ProfessionalError(
      `Limite de tentativas atingido. Aguarde ${minutes} minuto(s) antes de tentar novamente.`,
    );
  }
  if (!["linked", "already_linked"].includes(data.status))
    throw new ProfessionalError("Código inválido, expirado ou já utilizado.");
}

export async function listProfessionalPatients(
  signal?: AbortSignal,
): Promise<Crianca[]> {
  aborted(signal);
  const id = await userId();
  aborted(signal);
  const ids: string[] = [];
  let lastId: string | undefined;
  for (;;) {
    let query = client()
      .from("caa_members")
      .select("crianca_id")
      .eq("professional_id", id)
      .order("crianca_id")
      .limit(PAGE_SIZE);
    if (lastId) query = query.gt("crianca_id", lastId);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    aborted(signal);
    if (error) throw generic();
    const rows = data ?? [];
    if (!rows.length) break;
    for (const member of rows) {
      if (!UUID.test(member.crianca_id)) throw generic();
      ids.push(member.crianca_id);
    }
    const next = rows.at(-1)!.crianca_id;
    if (lastId && next <= lastId) throw generic();
    lastId = next;
  }
  if (!ids.length) return [];
  // Membership RLS is still enforced when selecting the children by these IDs.
  const children: Crianca[] = [];
  for (let offset = 0; offset < ids.length; offset += PAGE_SIZE) {
    const requested = ids.slice(offset, offset + PAGE_SIZE);
    let childCursor: string | undefined;
    for (;;) {
      let batch = client()
        .from("criancas")
        .select("*")
        .in("id", requested)
        .order("id")
        .limit(PAGE_SIZE);
      if (childCursor) batch = batch.gt("id", childCursor);
      if (signal) batch = batch.abortSignal(signal);
      const response = await batch;
      aborted(signal);
      if (response.error) throw generic();
      if (!response.data.length) break;
      if (response.data.some((child) => !requested.includes(child.id)))
        throw generic();
      children.push(...response.data);
      const next = response.data.at(-1)!.id;
      if (childCursor && next <= childCursor) throw generic();
      childCursor = next;
    }
  }
  return children.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function fetchPatientEvents(
  id: string,
  period: { from: string; to: string },
  signal?: AbortSignal,
): Promise<Comunicacao[]> {
  aborted(signal);
  patientId(id);
  const { start, end } = validateReportPeriod(period);
  const professionalId = await userId();
  aborted(signal);
  const requireMembership = async () => {
    let query = client()
      .from("caa_members")
      .select("id")
      .eq("crianca_id", id)
      .eq("professional_id", professionalId);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query.maybeSingle();
    aborted(signal);
    if (error) throw generic();
    if (!data)
      throw new ProfessionalError(
        "O vínculo com este paciente não está disponível. Atualize a lista de pacientes.",
      );
  };
  await requireMembership();
  const events: Comunicacao[] = [];
  const seen = new Set<string>();
  let cursor: Comunicacao | undefined;
  // Keyset pagination keeps a stable upper boundary without the workspace's
  // 500-event display limit; every page is constrained again by database RLS.
  const snapshotEnd = new Date().toISOString();
  for (;;) {
    let query = client()
      .from("caa_events")
      .select(FIELDS)
      .eq("crianca_id", id)
      .gte("created_at", start)
      .lt("created_at", end)
      .lte("created_at", snapshotEnd)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);
    if (cursor)
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    aborted(signal);
    if (error) throw generic();
    const rows = data ?? [];
    for (const row of rows) {
      if (
        row.crianca_id !== id ||
        !UUID.test(row.id) ||
        !Number.isFinite(Date.parse(row.created_at))
      )
        throw generic();
      if (!seen.has(row.id)) {
        events.push(row);
        seen.add(row.id);
      }
    }
    if (events.length > MAX_EVENTS)
      throw new ProfessionalError(
        "O período contém mais de 10.000 registros. Reduza o período para exportar todos os dados.",
      );
    if (!rows.length) break;
    const last = rows.at(-1)!;
    if (
      cursor &&
      (Date.parse(last.created_at) > Date.parse(cursor.created_at) ||
        (Date.parse(last.created_at) === Date.parse(cursor.created_at) &&
          last.id >= cursor.id))
    )
      throw generic();
    cursor = last;
  }
  await requireMembership();
  return events;
}
