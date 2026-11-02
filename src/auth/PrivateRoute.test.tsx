import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
} from "./AuthProvider";
import { PrivateRoute } from "./PrivateRoute";

vi.mock("../lib/supabase", () => ({
  supabase: null,
  configurationError: null,
}));

const demoUser: AuthUser = {
  id: "demo-123",
  name: "Usuário de Demonstração",
  email: "demo@comunica.com",
  role: "responsavel",
  emailConfirmed: true,
};

function auth(values: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    isMock: true,
    session: null,
    loading: false,
    error: null,
    isRecovery: false,
    signInWithGoogle: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    updatePassword: vi.fn(async () => {}),
    completeProfile: vi.fn(async () => {}),
    signIn: vi.fn(async () => {}),
    signUp: vi.fn(async () => "signed-in" as const),
    signOut: vi.fn(async () => {}),
    retrySession: vi.fn(async () => {}),
    ...values,
  };
}

function Login() {
  const location = useLocation();
  return (
    <>
      <h1>Login de teste</h1>
      <output aria-label="Retorno">{location.state?.from ?? ""}</output>
    </>
  );
}

function routed(value: AuthContextValue, initial = "/historico?periodo=30") {
  return (
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/confirmar-email"
            element={<h1>Confirmação pendente</h1>}
          />
          <Route path="/completar-perfil" element={<h1>Perfil pendente</h1>} />
          <Route
            path="/redefinir-senha"
            element={<h1>Recuperação de senha</h1>}
          />
          <Route path="/profissional" element={<h1>Painel profissional</h1>} />
          <Route element={<PrivateRoute />}>
            <Route path="/historico" element={<h1>Histórico protegido</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe("PrivateRoute", () => {
  it("blocks unconfirmed accounts before mounting protected children", () => {
    render(
      routed(
        auth({ user: { ...demoUser, emailConfirmed: false }, isMock: false }),
      ),
    );
    expect(
      screen.getByRole("heading", { name: "Confirmação pendente" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Histórico protegido")).not.toBeInTheDocument();
  });

  it("requires the canonical role before granting dashboard access", () => {
    render(routed(auth({ user: { ...demoUser, role: null }, isMock: false })));
    expect(
      screen.getByRole("heading", { name: "Perfil pendente" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Histórico protegido")).not.toBeInTheDocument();
  });

  it("keeps a verified recovery session in the reset flow", () => {
    render(routed(auth({ user: demoUser, isRecovery: true, isMock: false })));
    expect(
      screen.getByRole("heading", { name: "Recuperação de senha" }),
    ).toBeInTheDocument();
  });

  it("rejects a professional attempting to mount a guardian-only route", () => {
    render(
      <AuthContext.Provider
        value={auth({
          user: { ...demoUser, role: "fonoaudiologo" },
          isMock: false,
        })}
      >
        <MemoryRouter initialEntries={["/prancha"]}>
          <Routes>
            <Route
              path="/prancha"
              element={
                <PrivateRoute allowedRoles={["responsavel"]}>
                  <h1>Prancha privada</h1>
                </PrivateRoute>
              }
            />
            <Route
              path="/profissional"
              element={<h1>Painel profissional</h1>}
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(
      screen.getByRole("heading", { name: "Painel profissional" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Prancha privada")).not.toBeInTheDocument();
  });
  it("redirects a direct dashboard URL to login when the user is absent", async () => {
    render(routed(auth()));
    expect(
      await screen.findByRole("heading", { name: "Login de teste" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Histórico protegido" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Retorno")).toHaveTextContent(
      "/historico?periodo=30",
    );
  });

  it("waits for session restoration without flashing login or protected content", () => {
    const { rerender } = render(routed(auth({ loading: true })));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Restaurando sua sessão",
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    rerender(routed(auth({ user: demoUser })));
    expect(
      screen.getByRole("heading", { name: "Histórico protegido" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([true, false])(
    "accepts an authenticated user in mock mode = %s",
    (isMock) => {
      render(routed(auth({ user: demoUser, isMock })));
      expect(
        screen.getByRole("heading", { name: "Histórico protegido" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Login de teste" }),
      ).not.toBeInTheDocument();
    },
  );

  it("redirects after logout resets the context user", async () => {
    const { rerender } = render(routed(auth({ user: demoUser })));
    expect(
      screen.getByRole("heading", { name: "Histórico protegido" }),
    ).toBeInTheDocument();
    rerender(routed(auth()));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Login de teste" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { name: "Histórico protegido" }),
    ).not.toBeInTheDocument();
  });

  it("supports wrapping explicit children as well as nested route outlets", () => {
    render(
      <AuthContext.Provider value={auth({ user: demoUser })}>
        <MemoryRouter>
          <PrivateRoute>
            <h1>Prancha protegida</h1>
          </PrivateRoute>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(
      screen.getByRole("heading", { name: "Prancha protegida" }),
    ).toBeInTheDocument();
  });

  it("overwrites untrusted return state with the current internal dashboard path", async () => {
    render(
      <AuthContext.Provider value={auth()}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/historico",
              search: "?periodo=7",
              state: { from: "https://example.invalid/redirect" },
            },
          ]}
        >
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<PrivateRoute />}>
              <Route path="/historico" element={<h1>Histórico protegido</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(await screen.findByLabelText("Retorno")).toHaveTextContent(
      "/historico?periodo=7",
    );
    expect(screen.getByLabelText("Retorno")).not.toHaveTextContent("https://");
  });
});
