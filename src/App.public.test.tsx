import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AuthContext, type AuthContextValue } from "./auth/AuthProvider";

const workspace = vi.hoisted(() => vi.fn());
vi.mock("./lib/supabase", () => ({ supabase: null, configurationError: null }));
vi.mock("./hooks/useWorkspace", () => ({
  useWorkspace: (...args: unknown[]) => workspace(...args),
}));

function guest(loading = false): AuthContextValue {
  return {
    user: null,
    session: null,
    loading,
    isMock: false,
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

function mount(pathname: string, loading = false) {
  workspace.mockClear();
  return render(
    <AuthContext.Provider value={guest(loading)}>
      <MemoryRouter initialEntries={[pathname]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("Public information pages", () => {
  it.each([
    ["/sobre", "Símbolos e voz para comunicar escolhas."],
    ["/privacidade", "Política de privacidade"],
  ])("makes %s accessible while authentication is loading", (path, heading) => {
    mount(path, true);
    expect(screen.getByRole("heading", { name: heading, level: 1 })).toBeInTheDocument();
    expect(workspace).not.toHaveBeenCalled();
    expect(screen.queryByText("Restaurando sua sessão…")).not.toBeInTheDocument();
  });

  it("links the public overview to privacy information and login", () => {
    mount("/sobre");
    fireEvent.click(screen.getByRole("link", { name: "Consulte como os dados são utilizados" }));
    expect(screen.getByRole("heading", { name: "Política de privacidade", level: 1 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Entrar" }));
    expect(screen.getByRole("button", { name: "Entrar na minha conta" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sobre o Comunica" })).toHaveAttribute("href", "/sobre");
    expect(workspace).not.toHaveBeenCalled();
  });

  it.each(["/", "/historico"])("keeps the existing guest login guard for %s", (path) => {
    mount(path);
    expect(screen.getByRole("button", { name: "Entrar na minha conta" })).toBeInTheDocument();
    expect(workspace).not.toHaveBeenCalled();
  });
});
