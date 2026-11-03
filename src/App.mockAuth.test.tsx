import type { ComponentProps } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  AuthProvider,
  MOCK_AUTH_STORAGE_KEY,
  MOCK_USER,
} from "./auth/AuthProvider";

const mocks = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
  speech: {
    supported: true,
    voices: [],
    speaking: false,
    error: null,
    needsPlaybackGesture: false,
    speak: vi.fn(),
    stop: vi.fn(),
    retryPlayback: vi.fn(),
    prefetch: vi.fn(() => () => {}),
    prepareSentence: vi.fn(() => () => {}),
  },
}));

// A usable client is intentionally present: an accidental mock-mode request
// must be observable rather than silently skipped because configuration is absent.
vi.mock("./lib/supabase", () => ({
  configurationError: null,
  supabase: { auth: mocks.auth, from: mocks.from, rpc: mocks.rpc },
}));

vi.mock("./hooks/useSpeech", () => ({ useSpeech: () => mocks.speech }));

function RouteProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Rota atual">
        {location.pathname}
        {location.search}
      </output>
      <button type="button" onClick={() => navigate("/historico")}>
        Abrir histórico privado diretamente
      </button>
    </>
  );
}

function mount(
  entries: ComponentProps<typeof MemoryRouter>["initialEntries"] = ["/login"],
) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <AuthProvider>
        <App />
        <RouteProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function currentRoute() {
  return screen.getByLabelText("Rota atual").textContent;
}

async function finishLogin() {
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
}

function navigate(label: string) {
  const navigation = within(
    screen.getByRole("navigation", { name: "Navegação principal" }),
  );
  fireEvent.click(
    navigation.queryByRole("link", { name: label }) ??
      navigation.getByRole("button", { name: label }),
  );
}

function expectNoSupabaseRequests() {
  for (const method of Object.values(mocks.auth)) {
    expect(method).not.toHaveBeenCalled();
  }
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubEnv("MODE", "demo");
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("App: jornadas de autenticação simulada", () => {
  it("accepts a blank login after 800 ms and records a symbol locally in history", async () => {
    mount();
    expect(screen.getByLabelText("E-mail")).toHaveValue("");
    expect(screen.getByLabelText("Senha", { exact: true })).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    expect(currentRoute()).toBe("/login");
    expect(screen.getByRole("button", { name: "Entrando…" })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(currentRoute()).toBe("/prancha");
    expect(
      screen.getByRole("heading", { name: "Espaço para se expressar" }),
    ).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)!)).toEqual(
      MOCK_USER,
    );
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    navigate("Histórico");
    expect(currentRoute()).toBe("/historico");
    expect(
      within(
        screen.getByRole("region", { name: "Registros de comunicação" }),
      ).getByText("Água"),
    ).toBeInTheDocument();
    expectNoSupabaseRequests();
  });

  it("returns to a protected history URL after signing in", async () => {
    mount(["/historico?origem=apresentacao"]);
    expect(currentRoute()).toBe("/login");
    expect(
      screen.queryByRole("heading", { name: "As expressões de cada dia" }),
    ).not.toBeInTheDocument();
    await finishLogin();
    expect(currentRoute()).toBe("/historico?origem=apresentacao");
    expect(
      screen.getByRole("heading", { name: "As expressões de cada dia" }),
    ).toBeInTheDocument();
    expectNoSupabaseRequests();
  });

  it("restores the user after a reload while keeping demo communication records temporary", async () => {
    const first = mount();
    await finishLogin();
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    navigate("Histórico");
    expect(
      screen.getByRole("region", { name: "Registros de comunicação" }),
    ).toBeInTheDocument();
    first.unmount();

    mount(["/historico"]);
    expect(currentRoute()).toBe("/historico");
    expect(
      screen.queryByRole("button", { name: "Entrar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Cada expressão tem um começo" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Registros de comunicação" }),
    ).not.toBeInTheDocument();
    expectNoSupabaseRequests();
  });

  it("logs out, clears the stored user and protects the panel again", async () => {
    mount();
    await finishLogin();
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Sair da conta" })[0],
      );
    });
    expect(currentRoute()).toBe("/login");
    expect(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Abrir histórico privado diretamente",
      }),
    );
    expect(currentRoute()).toBe("/login");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
    await finishLogin();
    expect(currentRoute()).toBe("/historico");
    expectNoSupabaseRequests();
  });

  it("keeps board, evolution, settings and the professional panel isolated from Supabase", async () => {
    mount();
    await finishLogin();
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    navigate("Evolução");
    expect(currentRoute()).toBe("/evolucao");
    expect(
      screen.getByRole("heading", { name: "Símbolos mais utilizados" }),
    ).toBeInTheDocument();
    navigate("Ajustes");
    expect(currentRoute()).toBe("/ajustes");
    expect(
      screen.getByRole("heading", { name: "Voz e leitura" }),
    ).toBeInTheDocument();
    navigate("Profissional");
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(currentRoute()).toBe("/profissional");
    expect(
      screen.getByRole("heading", { name: "Acompanhamento fonoaudiológico" }),
    ).toBeInTheDocument();
    // Data from the actual professional demo hook proves the lazy panel loaded.
    expect(
      screen.getByRole("heading", { name: "Ana (demonstração)" }),
    ).toBeInTheDocument();
    expectNoSupabaseRequests();
  });

  it("rejects an external post-login destination", async () => {
    mount([
      { pathname: "/login", state: { from: "https://outside.example/panel" } },
    ]);
    await finishLogin();
    expect(currentRoute()).toBe("/prancha");
    expectNoSupabaseRequests();
  });

  it("lets a guest explore without granting access to protected routes", () => {
    mount(["/demonstracao/prancha"]);
    expect(currentRoute()).toBe("/demonstracao/prancha");
    expect(
      screen.getByRole("button", { name: "Falar Água" }),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Abrir histórico privado diretamente",
      }),
    );
    expect(currentRoute()).toBe("/login");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expectNoSupabaseRequests();
  });
});
