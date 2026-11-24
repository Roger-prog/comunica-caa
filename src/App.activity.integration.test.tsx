import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import type { Comunicacao, Database } from "./lib/database.types";
import { DEFAULT_BOARD_SETTINGS, type BoardSettingsRow, type CustomSymbol } from "./lib/patientBoardModel";

const fixture = vi.hoisted(() => ({
  client: null as SupabaseClient<Database> | null,
  speak: vi.fn((_text: string, options?: { onStart?: () => void }) => options?.onStart?.()),
}));
vi.mock("./lib/supabase", () => ({
  configurationError: null,
  get supabase() { return fixture.client; },
}));
vi.mock("./hooks/useSpeech", () => ({
  useSpeech: () => ({
    supported: true, voices: [], speaking: false, error: null, notice: null,
    needsPlaybackGesture: false, speak: fixture.speak, stop: () => {},
    retryPlayback: () => {}, prefetch: () => () => {}, prepareSentence: () => () => {},
    canRetrySynthesis: false, retrySynthesis: () => {}, canFallbackToDevice: false, fallbackToDevice: () => {},
  }),
}));

const parentId = "11111111-1111-4111-8111-111111111111";
const therapistId = "22222222-2222-4222-8222-222222222222";
const patientId = "33333333-3333-4333-8333-333333333333";
const symbolId = "44444444-4444-4444-8444-444444444444";
const secondPatientId = "66666666-6666-4666-8666-666666666666";
const faber = "pt_BR-faber-medium";
const edresson = "pt_BR-edresson-low";
const origin = "https://activity-sdk.example.test";

function sessionFor(id: string, email: string): Session {
  const epoch = Math.floor(Date.now() / 1000);
  const base64 = (data: object) => btoa(JSON.stringify(data)).replace(/=+$/, "");
  return {
    access_token: base64({ alg: "HS256" }) + "." + base64({ sub: id, exp: epoch + 3600 }) + ".test",
    refresh_token: "test-refresh", expires_in: 3600, expires_at: epoch + 3600, token_type: "bearer",
    user: {
      id, email, aud: "authenticated", role: "authenticated",
      created_at: "2026-01-01T00:00:00Z", email_confirmed_at: "2026-01-01T00:00:00Z",
      app_metadata: {}, user_metadata: {},
    },
  };
}

// The real Supabase SDK builds the requests. Only the managed HTTP responses
// and audio start are simulated here; migrations and RLS have a separate suite.
let fixtureNumber = 0;

function connect({ twoPatients = false, professionalBoardAccess = false } = {}) {
  const sessions = [
    sessionFor(parentId, "responsavel@example.test"),
    sessionFor(therapistId, "profissional@example.test"),
  ];
  const patient = {
    id: patientId, usuario_id: parentId, nome: "Paciente fictício",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const events: Comunicacao[] = [];
  const secondPatient = { ...patient, id: secondPatientId, nome: "Segundo paciente fictício" };
  const boards = new Map<string, BoardSettingsRow>();
  if (twoPatients) boards.set(secondPatientId, {
    crianca_id: secondPatientId,
    settings: { ...DEFAULT_BOARD_SETTINGS, voiceURI: faber, rate: 0.7 },
    version: 1,
    updated_at: secondPatient.updated_at,
  });
  let symbol: CustomSymbol | undefined;
  const api: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, origin);
    const name = url.pathname.split("/").at(-1);
    const headers = new Headers(init?.headers);
    const viewer = sessions.find((session) => headers.get("Authorization") === "Bearer " + session.access_token)?.user;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const patientMatches = (parameter: string) => url.searchParams.get(parameter) === "eq." + patientId;
    const requestedChildId = url.searchParams.get("crianca_id")?.replace(/^eq\./, "") ?? "";
    const editable = viewer?.id === parentId || (viewer?.id === therapistId && professionalBoardAccess);
    const json = (value: unknown) => new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    });
    const rows = (values: object[]) => json(headers.get("Accept")?.includes("vnd.pgrst.object")
      ? values[0] ?? null : values);

    if (url.pathname === "/api/arasaac-search") return json([{ id: 123, labels: ["gato"] }]);
    if (name === "token") return json(sessions.find((session) => session.user.email === body.email));
    if (name === "logout") return new Response(null, { status: 204 });
    if (!viewer) return new Response(null, { status: 401 });
    if (name === "user") return json(viewer);
    if (name === "caa_profiles") return rows([{
      id: viewer.id, nome: viewer.id === parentId ? "Responsável fictício" : "Profissional fictício",
      role: viewer.id === parentId ? "responsavel" : "fonoaudiologo",
    }]);
    if (name === "criancas") {
      const idFilters = url.searchParams.getAll("id");
      if (idFilters.some((filter) => filter.startsWith("gt."))) return rows([]);
      const available = viewer.id === parentId && twoPatients ? [patient, secondPatient] : [patient];
      const exactId = idFilters.find((filter) => filter.startsWith("eq."))?.slice(3);
      return rows(exactId ? available.filter((child) => child.id === exactId) : available);
    }
    if (name === "caa_members") return rows(
      viewer.id === therapistId && !url.searchParams.get("crianca_id")?.startsWith("gt.")
        ? [{ id: "member", crianca_id: patientId, professional_id: therapistId, board_access: professionalBoardAccess }] : [],
    );
    if (name === "list_caa_members") return json([]);
    if (name === "get_caa_pronunciation_settings") return rows([{
      can_read: viewer.id === parentId, can_record: viewer.id === parentId,
      can_manage: viewer.id === parentId, retention_days: viewer.id === parentId ? 90 : null,
    }]);
    if (name === "list_caa_pronunciation" || name === "list_caa_pronunciation_access") return json([]);
    if (name === "query_caa_history") {
      const start = body.p_from && Date.parse(body.p_from + "T00:00:00-03:00");
      const end = body.p_to && Date.parse(body.p_to + "T00:00:00-03:00") + 86_400_000;
      const authorized = viewer.id === parentId && (body.p_crianca_id === patientId ||
        (twoPatients && body.p_crianca_id === secondPatientId));
      return json(authorized ? events.filter((event) =>
        event.crianca_id === body.p_crianca_id &&
        (!body.p_event_type || event.event_type === body.p_event_type) &&
        (!body.p_search || event.rotulo.toLowerCase().includes(body.p_search)) &&
        (!start || (Date.parse(event.created_at) >= start && Date.parse(event.created_at) < end)) &&
        (!body.p_before_time || event.created_at < body.p_before_time ||
          (event.created_at === body.p_before_time && event.id < body.p_before_id)),
      ).slice(0, 101) : []);
    }
    if (name === "has_caa_board_access") {
      const allowedPatient = body.p_crianca_id === patientId ||
        (viewer.id === parentId && twoPatients && body.p_crianca_id === secondPatientId);
      return json(editable && allowedPatient);
    }
    if (name === "caa_catalog_overrides") return json([]);
    if (name === "caa_custom_symbols") return json(symbol && patientMatches("crianca_id") ? [symbol] : []);
    if (name === "caa_board_settings") {
      const board = boards.get(requestedChildId);
      return json(editable && board ? [board] : []);
    }
    if (name === "save_caa_custom_symbol" && editable && body.p_crianca_id === patientId) {
      symbol = {
        id: symbolId, crianca_id: patientId, created_by: viewer.id, label: body.p_label,
        speech_text: body.p_speech_text, categories: body.p_categories, arasaac_id: body.p_arasaac_id,
        image_path: null, source: "arasaac", hidden: false, version: 1,
        created_at: patient.created_at, updated_at: patient.updated_at,
      };
      return json({ symbol, retired_path: null });
    }
    if (name === "save_caa_board_settings" && editable && body.p_crianca_id === patientId) {
      const board = { crianca_id: patientId, settings: body.p_settings, version: (boards.get(patientId)?.version ?? 0) + 1,
        updated_at: new Date().toISOString() };
      boards.set(patientId, board);
      return json(board);
    }
    if (name === "comunicacoes" && init?.method === "POST") {
      const allowedPatient = body.crianca_id === patientId || (twoPatients && body.crianca_id === secondPatientId);
      if (viewer.id !== parentId || !allowedPatient || body.usuario_id !== viewer.id ||
          boards.get(body.crianca_id)?.settings.historyRecording === false) return new Response(null, { status: 403 });
      const event = { ...body, created_at: new Date().toISOString() } as Comunicacao;
      events.unshift(event);
      return json(event);
    }
    const eligiblePatient = requestedChildId === patientId ||
      (viewer.id === parentId && twoPatients && requestedChildId === secondPatientId);
    if ((name === "comunicacoes" || name === "caa_events") && eligiblePatient) {
      if (init?.method === "DELETE") {
        if (viewer.id !== parentId) return new Response(null, { status: 403 });
        const before = url.searchParams.get("created_at")?.replace(/^lt\./, "");
        const remaining = events.filter((item) =>
          item.crianca_id !== requestedChildId || (before && item.created_at >= before));
        events.splice(0, events.length, ...remaining);
        return new Response(null, { status: 204 });
      }
      const cursor = url.searchParams.get("or");
      const cursorTime = cursor?.match(/created_at\.lt\.([^,]+)/)?.[1];
      const limit = Number(url.searchParams.get("limit")) || events.length;
      const matching = events.filter((item) =>
        item.crianca_id === requestedChildId && (!cursorTime || item.created_at < cursorTime));
      return json(matching.slice(0, limit));
    }
    throw new Error("Unexpected activity fixture request " + url.pathname);
  };
  vi.stubGlobal("fetch", api);
  fixture.client = createClient<Database>(origin, "sb_publishable_activity_sdk_test", {
    auth: {
      storageKey: "comunica-activity-sdk-test-" + ++fixtureNumber, flowType: "pkce",
      autoRefreshToken: false, persistSession: true, detectSessionInUrl: false,
    },
    global: { fetch: api },
  });
  return events;
}

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

function navigate(name: string) {
  const nav = within(screen.getByRole("navigation", { name: "Navegação principal" }));
  fireEvent.click(nav.queryByRole("link", { name }) ?? nav.getByRole("button", { name }));
}

async function signIn(email: string) {
  fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-apenas-do-teste" } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar na minha conta" }));
}

async function createTestSymbol(label: string, speechText: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Criar símbolo" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Nome do símbolo" }), { target: { value: label } });
  fireEvent.change(screen.getByRole("textbox", { name: "Frase falada" }), { target: { value: speechText } });
  fireEvent.click(screen.getByRole("button", { name: "Escolher pictograma ARASAAC" }));
  const picker = within(screen.getByRole("region", { name: "Galeria de pictogramas ARASAAC" }));
  fireEvent.change(picker.getByRole("searchbox"), { target: { value: "gato" } });
  fireEvent.click(picker.getByRole("button", { name: /^gato$/i }));
  fireEvent.click(await picker.findByRole("button", { name: "gato, pictograma 123" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Adicionar aos favoritos" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Mostrar no Início" }));
  fireEvent.click(screen.getByRole("button", { name: "Salvar símbolo" }));
  await screen.findByText("Símbolo criado.");
}

afterEach(async () => {
  fixture.speak.mockClear();
  cleanup();
  await fixture.client?.auth.stopAutoRefresh();
  fixture.client = null;
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("persists custom and official selections and one played message across a reload and a linked professional login", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const events = connect();
  const parent = mount("/login");
  await signIn("responsavel@example.test");
  await screen.findByRole("button", { name: "Falar Água" });
  navigate("Ajustes");
  await createTestSymbol("Meu gato", "Ver meu gato");

  navigate("Prancha");
  fireEvent.click(await screen.findByRole("button", { name: "Falar Água" }));
  fireEvent.click(screen.getByRole("button", { name: "Categorias" }));
  fireEvent.click(screen.getByRole("button", { name: "Favoritos" }));
  fireEvent.click(await screen.findByRole("button", { name: "Falar Meu gato" }));
  fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
  navigate("Histórico");
  await screen.findByText("Água Ver meu gato");
  expect(screen.getByText("Meu gato", { exact: true })).toBeInTheDocument();
  expect(events).toHaveLength(3);
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ crianca_id: patientId, event_type: "symbol_selection", pictograma_id: symbolId,
      rotulo: "Meu gato", symbol_source: "custom", arasaac_id: 123 }),
    expect.objectContaining({ event_type: "message_playback", pictograma_id: null, rotulo: "Água Ver meu gato" }),
  ]));
  expect(fixture.speak).toHaveBeenLastCalledWith("Água Ver meu gato", expect.objectContaining({
    offlineOnly: true, voiceURI: DEFAULT_BOARD_SETTINGS.voiceURI, rate: DEFAULT_BOARD_SETTINGS.rate,
  }));
  navigate("Evolução");
  await screen.findByText("Meu gato", { exact: true });

  parent.unmount();
  const reloaded = mount("/historico");
  await screen.findByText("Água Ver meu gato");
  expect(screen.getByText("Meu gato", { exact: true })).toBeInTheDocument();
  reloaded.unmount();
  await fixture.client!.auth.signOut();

  mount("/login");
  await signIn("profissional@example.test");
  fireEvent.click(await screen.findByRole("button", { name: "Paciente fictício" }));
  await waitFor(() => {
    expect(screen.getByText("Água Ver meu gato")).toBeInTheDocument();
    expect(screen.getAllByText("Meu gato", { exact: true }).length).toBeGreaterThan(0);
  });
  expect(screen.queryByRole("button", { name: "Iniciar modo comunicação" })).not.toBeInTheDocument();
}, 20_000);

it("can search older history, pause recording and delete only records before a selected cutoff", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const events = connect();
  for (let index = 0; index < 502; index++) {
    events.push({
      id: "55555555-5555-4555-8555-" + index.toString().padStart(12, "0"),
      usuario_id: parentId, crianca_id: patientId, pictograma_id: "agua",
      arasaac_id: null, symbol_source: "catalog", categoria: "Necessidades",
      event_type: "symbol_selection",
      rotulo: index === 501 ? "Registro mais antigo" : "Água",
      created_at: new Date(Date.now() - index * 86_400_000).toISOString(),
    });
  }
  mount("/login");
  await signIn("responsavel@example.test");
  await screen.findByRole("button", { name: "Falar Água" });
  navigate("Histórico");
  await screen.findByRole("button", { name: "Carregar registros anteriores" });
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar no histórico" }), { target: { value: "Registro mais antigo" } });
  expect(screen.queryByText("Registro mais antigo")).not.toBeInTheDocument();
  expect(await screen.findByText("Registro mais antigo")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Carregar registros anteriores" })).not.toBeInTheDocument();

  navigate("Ajustes");
  fireEvent.click(await screen.findByRole("button", { name: "Pausar novos registros" }));
  await screen.findByRole("button", { name: "Retomar registros" });
  navigate("Prancha");
  fireEvent.click(await screen.findByRole("button", { name: "Falar Água" }));
  fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
  expect(events).toHaveLength(502);

  navigate("Ajustes");
  fireEvent.click(await screen.findByRole("button", { name: "Excluir registros" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
  await screen.findByText("Os registros selecionados foram excluídos.");
  expect(events.length).toBeGreaterThan(0);
  expect(events.length).toBeLessThan(32);
  navigate("Histórico");
  await screen.findByRole("region", { name: "Registros de comunicação" });
  expect(screen.queryByText("Registro mais antigo")).not.toBeInTheDocument();
}, 20_000);

it("keeps each patient's saved neural voice after a preference change, switch and reload", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  connect({ twoPatients: true });
  const parent = mount("/login");
  await signIn("responsavel@example.test");
  await screen.findByRole("button", { name: "Falar Água" });
  navigate("Ajustes");
  await createTestSymbol("Símbolo fictício", "Um gato amarelo");

  fireEvent.click(screen.getByRole("button", { name: "Preferências" }));
  fireEvent.click(screen.getByRole("button", { name: "Voz" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Voz da prancha" }), { target: { value: edresson } });
  fireEvent.change(screen.getByRole("slider", { name: /velocidade da voz/i }), { target: { value: "1.3" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
  await screen.findByText("Preferências da prancha salvas.");

  navigate("Prancha");
  fireEvent.click(await screen.findByRole("button", { name: "Falar Água" }));
  fireEvent.click(screen.getByRole("button", { name: "Categorias" }));
  fireEvent.click(screen.getByRole("button", { name: "Meus símbolos" }));
  fireEvent.click(screen.getByRole("button", { name: "Falar Símbolo fictício" }));
  fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
  expect(fixture.speak.mock.calls.slice(-3)).toEqual(
    ["Água", "Um gato amarelo", "Água Um gato amarelo"].map((text) => [
      text, expect.objectContaining({ voiceURI: edresson, rate: 1.3 }),
    ]),
  );

  const profileSelect = screen.getByRole("combobox", { name: "Perfil da criança" });
  fireEvent.change(profileSelect, { target: { value: secondPatientId } });
  fireEvent.click(await screen.findByRole("button", { name: "Falar Água" }));
  expect(fixture.speak).toHaveBeenLastCalledWith("Água", expect.objectContaining({ voiceURI: faber, rate: 0.7 }));
  expect(screen.queryByRole("button", { name: "Falar Símbolo fictício" })).not.toBeInTheDocument();

  parent.unmount();
  mount("/prancha");
  fireEvent.click(await screen.findByRole("button", { name: "Categorias" }));
  fireEvent.click(screen.getByRole("button", { name: "Meus símbolos" }));
  fireEvent.click(screen.getByRole("button", { name: "Falar Símbolo fictício" }));
  expect(fixture.speak).toHaveBeenLastCalledWith("Um gato amarelo", expect.objectContaining({ voiceURI: edresson, rate: 1.3 }));
}, 20_000);

it("plays a symbol created by an authorized professional using the patient's preferences", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  connect({ professionalBoardAccess: true });
  const therapist = mount("/login");
  await signIn("profissional@example.test");
  fireEvent.click(await screen.findByRole("button", { name: "Paciente fictício" }));
  fireEvent.click(await screen.findByText("Personalizar prancha de Paciente fictício"));
  await createTestSymbol("Cadastrado em consulta", "Um animal de estimação");
  therapist.unmount();
  await fixture.client!.auth.signOut();

  mount("/login");
  await signIn("responsavel@example.test");
  fireEvent.click(await screen.findByRole("button", { name: "Categorias" }));
  fireEvent.click(screen.getByRole("button", { name: "Meus símbolos" }));
  fireEvent.click(screen.getByRole("button", { name: "Falar Cadastrado em consulta" }));
  expect(fixture.speak).toHaveBeenLastCalledWith("Um animal de estimação", expect.objectContaining({
    voiceURI: DEFAULT_BOARD_SETTINGS.voiceURI, rate: DEFAULT_BOARD_SETTINGS.rate,
  }));
}, 20_000);
