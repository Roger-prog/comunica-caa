import { webcrypto } from "node:crypto";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
} from "./auth/AuthProvider";

const fixtures = vi.hoisted(() => ({
  workspace: vi.fn(),
  speech: {
    supported: true,
    voices: [],
    speaking: false,
    error: null,
    speak: vi.fn(),
    stop: vi.fn(),
    prefetch: vi.fn(() => () => {}),
    prepareSentence: vi.fn(() => () => {}),
  },
}));

vi.mock("./lib/supabase", () => ({ supabase: null, configurationError: null }));
vi.mock("./hooks/useSpeech", () => ({ useSpeech: () => fixtures.speech }));
vi.mock("./hooks/useWorkspace", () => ({
  useWorkspace: (...args: unknown[]) => fixtures.workspace(...args),
}));
vi.mock("./components/ProfessionalDashboard", () => ({
  ProfessionalDashboard: () => <h2>Pacientes vinculados</h2>,
}));

const person: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Pessoa de exemplo",
  email: "exemplo@example.com",
  role: "responsavel",
  emailConfirmed: true,
};

function auth(user: AuthUser = person): AuthContextValue {
  const session = {
    access_token: "fixture-token",
    refresh_token: "fixture-refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: user.id,
      email: user.email,
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
      app_metadata: {},
      user_metadata: { role: "admin" },
    },
  } satisfies Session;
  return {
    user,
    session,
    isMock: false,
    loading: false,
    error: null,
    isRecovery: false,
    signIn: vi.fn(async () => {}),
    signUp: vi.fn(async () => "confirmation-required" as const),
    signOut: vi.fn(async () => {}),
    retrySession: vi.fn(async () => {}),
    signInWithGoogle: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    updatePassword: vi.fn(async () => {}),
    completeProfile: vi.fn(async () => {}),
  };
}

function routed(context: AuthContextValue, pathname: string) {
  return (
    <AuthContext.Provider value={context}>
      <MemoryRouter initialEntries={[pathname]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto as unknown as Crypto);
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  fixtures.workspace.mockReturnValue({
    profile: null,
    children: [],
    selectedId: "",
    selectedChild: null,
    events: [],
    loading: false,
    historyLoading: false,
    error: null,
    saveError: null,
    pendingWrites: 0,
    setSelectedId: vi.fn(),
    addChild: vi.fn(),
    record: vi.fn(),
    reload: vi.fn(),
    dismissSaveError: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("App: real account roles and authentication routes", () => {
  it.each(["changed-role", "failed-profile"])(
    "does not let the child lock override %s",
    async (scenario) => {
      const initial = auth();
      const { rerender } = render(routed(initial, "/prancha"));
      fireEvent.click(
        screen.getByRole("button", { name: "Iniciar modo criança" }),
      );
      fireEvent.change(screen.getByLabelText("Novo PIN"), {
        target: { value: "4826" },
      });
      fireEvent.change(screen.getByLabelText("Confirmar PIN"), {
        target: { value: "4826" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Salvar PIN e iniciar" }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(
        screen.getByRole("button", { name: "Desbloquear modo criança" }),
      ).toBeInTheDocument();
      rerender(
        routed(
          {
            ...initial,
            user:
              scenario === "changed-role"
                ? { ...person, role: "fonoaudiologo" }
                : null,
          },
          "/prancha",
        ),
      );
      expect(
        await screen.findByRole("heading", {
          name:
            scenario === "changed-role"
              ? "Pacientes vinculados"
              : "Que bom ter você aqui.",
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Desbloquear modo criança" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Falar Água" }),
      ).not.toBeInTheDocument();
    },
  );
  it.each(["/prancha", "/historico", "/evolucao"])(
    "keeps professionals out of %s and does not load a guardian workspace",
    async (pathname) => {
      render(routed(auth({ ...person, role: "fonoaudiologo" }), pathname));
      expect(
        await screen.findByRole("heading", { name: "Pacientes vinculados" }),
      ).toBeInTheDocument();
      const navigation = within(
        screen.getByRole("navigation", { name: "Navegação principal" }),
      );
      expect(
        navigation.queryByRole("button", { name: "Prancha" }),
      ).not.toBeInTheDocument();
      expect(
        navigation.queryByRole("button", { name: "Histórico" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("combobox", { name: "Perfil da criança" }),
      ).not.toBeInTheDocument();
      expect(fixtures.workspace).toHaveBeenLastCalledWith(null, false, false);
    },
  );

  it("returns guardians to the board when they enter the professional URL", () => {
    render(routed(auth(), "/profissional"));
    expect(
      screen.getByRole("heading", { name: "Espaço para se expressar" }),
    ).toBeInTheDocument();
    const navigation = within(
      screen.getByRole("navigation", { name: "Navegação principal" }),
    );
    expect(
      navigation.queryByRole("button", { name: "Profissional" }),
    ).not.toBeInTheDocument();
    expect(fixtures.workspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: person.id }),
      false,
      true,
    );
  });

  it("shows only account settings to a professional without child controls", () => {
    render(routed(auth({ ...person, role: "fonoaudiologo" }), "/ajustes"));
    expect(
      screen.getByRole("heading", { name: "Conta profissional" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Adicionar perfil" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Acompanhamento profissional" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Visual da prancha" }),
    ).not.toBeInTheDocument();
  });

  it("requires first-access profile completion even if Auth metadata claims admin", () => {
    render(routed(auth({ ...person, role: null }), "/prancha"));
    expect(
      screen.getByRole("heading", { name: "Complete seu perfil" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Responsável/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Fonoaudiólogo/ }),
    ).not.toBeChecked();
    expect(fixtures.workspace).not.toHaveBeenCalled();
  });

  it("blocks both dashboard roles until email is confirmed", () => {
    render(
      routed(
        auth({ ...person, role: "fonoaudiologo", emailConfirmed: false }),
        "/profissional",
      ),
    );
    expect(
      screen.getByRole("heading", { name: "Confirme seu e-mail" }),
    ).toBeInTheDocument();
    expect(fixtures.workspace).not.toHaveBeenCalled();
  });

  it("does not honor a return URL that belongs to the other role", async () => {
    render(
      <AuthContext.Provider value={auth({ ...person, role: "fonoaudiologo" })}>
        <MemoryRouter
          initialEntries={[{ pathname: "/login", state: { from: "/prancha" } }]}
        >
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Pacientes vinculados" }),
    ).toBeInTheDocument();
  });

  it("keeps reset success visible through USER_UPDATED profile loading", async () => {
    let finishUpdate!: () => void;
    const initial = {
      ...auth(),
      isRecovery: true,
      updatePassword: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishUpdate = resolve;
          }),
      ),
    };
    const { rerender } = render(routed(initial, "/redefinir-senha"));
    fireEvent.change(screen.getByLabelText("Nova senha", { exact: true }), {
      target: { value: "ficticia-senha-123" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
      target: { value: "ficticia-senha-123" },
    });
    fireEvent.submit(
      screen.getByLabelText("Nova senha", { exact: true }).closest("form")!,
    );
    rerender(
      routed(
        { ...initial, user: null, loading: true, isRecovery: false },
        "/redefinir-senha",
      ),
    );
    await act(async () => {
      finishUpdate();
    });
    rerender(
      routed(
        { ...initial, loading: false, isRecovery: false },
        "/redefinir-senha",
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Senha atualizada");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sair e entrar novamente" }),
    ).toBeInTheDocument();
  });
});
