import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./authTypes";
import type { Session } from "@supabase/supabase-js";
import { AuthPage } from "./AuthPage";
import { Cadastro } from "./Cadastro";
import { EsqueciSenha } from "./EsqueciSenha";
import { RedefinirSenha } from "./RedefinirSenha";
import { CompletarPerfil } from "./CompletarPerfil";
import { AuthCallback } from "./AuthCallback";

const mocks = vi.hoisted(() => ({
  isMock: false,
  loading: false,
  isRecovery: false,
  user: null as AuthUser | null,
  session: null as Session | null,
  error: null as string | null,
  supabase: {} as object | null,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  retrySession: vi.fn(),
  signInWithGoogle: vi.fn(),
  resetPassword: vi.fn(),
  updatePassword: vi.fn(),
  completeProfile: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return mocks.supabase;
  },
  get configurationError() {
    return mocks.supabase ? null : "Conexão não configurada para este teste.";
  },
}));
vi.mock("./AuthProvider", () => ({ useAuth: () => mocks }));

function user(
  role: AuthUser["role"] = "responsavel",
  emailConfirmed = true,
): AuthUser {
  return {
    id: "user-test",
    name: "Perfil fictício",
    email: "perfil@example.test",
    role,
    emailConfirmed,
  };
}

function mount(component: ReactNode, url = "/test") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/test" element={component} />
        <Route path="/login" element={<p>Destino: login</p>} />
        <Route path="/prancha" element={<p>Destino: prancha</p>} />
        <Route path="/profissional" element={<p>Destino: profissional</p>} />
        <Route
          path="/completar-perfil"
          element={<p>Destino: completar perfil</p>}
        />
        <Route
          path="/redefinir-senha"
          element={<p>Destino: redefinir senha</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function fillRegistration() {
  fireEvent.change(screen.getByLabelText("Nome", { exact: true }), {
    target: { value: "Perfil fictício" },
  });
  fireEvent.change(screen.getByLabelText("E-mail"), {
    target: { value: "perfil@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Senha", { exact: true }), {
    target: { value: "test-only-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirmar senha"), {
    target: { value: "test-only-password" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
}

async function submitForm(label: string) {
  await act(async () => {
    fireEvent.submit(
      screen.getByLabelText(label, { exact: true }).closest("form")!,
    );
  });
}

beforeEach(() => {
  mocks.isMock = false;
  mocks.loading = false;
  mocks.isRecovery = false;
  mocks.user = null;
  mocks.session = null;
  mocks.error = null;
  mocks.supabase = {};
  for (const method of [
    mocks.signIn,
    mocks.signOut,
    mocks.retrySession,
    mocks.signInWithGoogle,
    mocks.resetPassword,
    mocks.updatePassword,
    mocks.completeProfile,
  ])
    method.mockReset().mockResolvedValue(undefined);
  mocks.signUp.mockReset().mockResolvedValue("confirmation-required");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Login", () => {
  it("preserves blank mock login and prevents duplicate requests during the simulated delay", async () => {
    mocks.isMock = true;
    mocks.supabase = null;
    vi.useFakeTimers();
    mocks.signIn.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 800)),
    );
    mount(<AuthPage onPreview={vi.fn()} />);
    expect(screen.getByText("Acesso de demonstração")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Entrar com Google" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).not.toBeRequired();
    const form = screen.getByLabelText("E-mail").closest("form")!;
    expect(form).toHaveAttribute("novalidate");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    fireEvent.submit(form);
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith("", "");
    expect(screen.getByRole("button", { name: "Entrando…" })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });

  it("does not persist credentials entered in the mock form", async () => {
    mocks.isMock = true;
    mocks.supabase = null;
    const storage = vi.spyOn(Storage.prototype, "setItem");
    mount(<AuthPage onPreview={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "invalid-email" },
    });
    fireEvent.change(screen.getByLabelText("Senha", { exact: true }), {
      target: { value: "x" },
    });
    await submitForm("E-mail");
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith("invalid-email", "x");
    expect(storage).not.toHaveBeenCalled();
  });

  it("keeps real authentication disabled when configuration is absent", () => {
    mocks.supabase = null;
    mount(<AuthPage onPreview={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Entrar na minha conta" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Entrar com Google" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("E-mail")).toBeRequired();
    expect(screen.getByLabelText("E-mail").closest("form")).not.toHaveAttribute(
      "novalidate",
    );
    expect(screen.getByText(/Conexão não configurada/)).toBeInTheDocument();
  });

  it("submits real credentials and offers email confirmation guidance", async () => {
    mount(<AuthPage onPreview={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "perfil@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Senha", { exact: true }), {
      target: { value: "test-only-password" },
    });
    await submitForm("E-mail");
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith(
      "perfil@example.test",
      "test-only-password",
    );
    expect(
      screen.getByText(/Confirme seu e-mail pelo link recebido/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Criar conta" })).toHaveAttribute(
      "href",
      "/cadastro",
    );
    expect(
      screen.getByRole("link", { name: "Esqueci minha senha" }),
    ).toHaveAttribute("href", "/esqueci-senha");
  });

  it("invokes Google independently of password credentials and restores usability on error", async () => {
    mocks.signInWithGoogle.mockRejectedValueOnce(
      new Error("Não foi possível iniciar o acesso com Google."),
    );
    mount(<AuthPage onPreview={vi.fn()} />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Entrar com Google" }),
      );
    });
    expect(mocks.signInWithGoogle).toHaveBeenCalledOnce();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível iniciar o acesso com Google.",
    );
    expect(
      screen.getByRole("button", { name: "Entrar com Google" }),
    ).toBeEnabled();
  });
});

describe("Cadastro", () => {
  it("requires an explicit account role and rejects submissions without a choice", async () => {
    mount(<Cadastro />);
    fillRegistration();
    expect(
      screen
        .getAllByRole("radio")
        .every((radio) => !(radio as HTMLInputElement).checked),
    ).toBe(true);
    await submitForm("Nome");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Escolha o tipo de conta",
    );
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("passes the selected role and clears passwords while requesting confirmation", async () => {
    mount(<Cadastro />);
    fillRegistration();
    fireEvent.click(screen.getByRole("radio", { name: /Fonoaudiólogo/ }));
    await submitForm("Nome");
    expect(mocks.signUp).toHaveBeenCalledExactlyOnceWith(
      "Perfil fictício",
      "perfil@example.test",
      "test-only-password",
      true,
      "fonoaudiologo",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Verifique a caixa de entrada e a pasta de spam",
    );
    expect(screen.getByLabelText("Senha", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Confirmar senha")).toHaveValue("");
  });

  it("rejects a mismatched password confirmation without a request", async () => {
    mount(<Cadastro />);
    fillRegistration();
    fireEvent.click(screen.getByRole("radio", { name: /Responsável/ }));
    fireEvent.change(screen.getByLabelText("Confirmar senha"), {
      target: { value: "different-password" },
    });
    await submitForm("Nome");
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("não coincidem");
  });

  it("offers Google for registration and mandatory profile completion guidance", async () => {
    mount(<Cadastro />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Entrar com Google" }),
      );
    });
    expect(mocks.signInWithGoogle).toHaveBeenCalledOnce();
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(
      screen.getByText(/No primeiro acesso com Google/),
    ).toBeInTheDocument();
  });
});

describe("EsqueciSenha", () => {
  it("requests recovery and shows the same neutral result for an account address", async () => {
    mount(<EsqueciSenha />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "perfil@example.test" },
    });
    await submitForm("E-mail");
    expect(mocks.resetPassword).toHaveBeenCalledExactlyOnceWith(
      "perfil@example.test",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Se houver uma conta com esse e-mail",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Abra o link neste navegador",
    );
  });

  it("keeps the request form usable when sending the link fails", async () => {
    mocks.resetPassword.mockRejectedValueOnce(
      new Error("Aguarde alguns minutos antes de tentar novamente."),
    );
    mount(<EsqueciSenha />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "perfil@example.test" },
    });
    await submitForm("E-mail");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Aguarde alguns minutos",
    );
    expect(
      screen.getByRole("button", { name: "Enviar link de recuperação" }),
    ).toBeEnabled();
  });
});

describe("RedefinirSenha", () => {
  it("does not enable password changes from a forged URL without verified recovery state", () => {
    mocks.user = user();
    mount(<RedefinirSenha />, "/test?type=recovery&access_token=fake");
    expect(screen.getByRole("alert")).toHaveTextContent("inválido ou expirou");
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it("waits for recovery validation before showing an expired-link error", () => {
    mocks.loading = true;
    mount(<RedefinirSenha />);
    expect(screen.getByRole("status")).toHaveTextContent("Validando o link");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("preserves the update confirmation even when ending the session fails", async () => {
    mocks.user = user();
    mocks.session = { user: { id: "user-test" } } as Session;
    mocks.isRecovery = true;
    mocks.updatePassword.mockImplementation(async () => {
      mocks.isRecovery = false;
    });
    mocks.signOut.mockRejectedValueOnce(new Error("private diagnostic"));
    mount(<RedefinirSenha />);
    fireEvent.change(screen.getByLabelText("Nova senha", { exact: true }), {
      target: { value: "updated-test-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
      target: { value: "updated-test-password" },
    });
    await submitForm("Nova senha");
    expect(mocks.updatePassword).toHaveBeenCalledExactlyOnceWith(
      "updated-test-password",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Senha atualizada");
    expect(
      screen.queryByLabelText("Nova senha", { exact: true }),
    ).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Sair e entrar novamente" }),
      );
    });
    expect(screen.getByRole("status")).toHaveTextContent("Senha atualizada");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "não foi possível encerrar a sessão",
    );
    expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Sair e entrar novamente" }),
      );
    });
    expect(screen.getByText("Destino: login")).toBeInTheDocument();
  });

  it("rejects inconsistent new passwords before updating the credential", async () => {
    mocks.user = user();
    mocks.session = { user: { id: "user-test" } } as Session;
    mocks.isRecovery = true;
    mount(<RedefinirSenha />);
    fireEvent.change(screen.getByLabelText("Nova senha", { exact: true }), {
      target: { value: "updated-test-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
      target: { value: "different-password" },
    });
    await submitForm("Nova senha");
    expect(mocks.updatePassword).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("não coincidem");
  });

  it("permits verified recovery without a loaded application profile", async () => {
    mocks.user = null;
    mocks.error = "Não foi possível carregar seu perfil.";
    mocks.session = { user: { id: "user-test" } } as Session;
    mocks.isRecovery = true;
    mount(<RedefinirSenha />);
    fireEvent.change(screen.getByLabelText("Nova senha", { exact: true }), {
      target: { value: "updated-test-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
      target: { value: "updated-test-password" },
    });
    await submitForm("Nova senha");
    expect(mocks.updatePassword).toHaveBeenCalledExactlyOnceWith(
      "updated-test-password",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Senha atualizada");
  });
});

describe("CompletarPerfil", () => {
  it("requires role and consent before completing a Google profile", async () => {
    mocks.user = user(null);
    mount(<CompletarPerfil />);
    await submitForm("Nome");
    expect(mocks.completeProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Responsável/ }));
    fireEvent.click(screen.getByRole("checkbox"));
    await submitForm("Nome");
    expect(mocks.completeProfile).toHaveBeenCalledExactlyOnceWith(
      "responsavel",
      "Perfil fictício",
      true,
    );
  });

  it("does not expose onboarding to an unconfirmed account", () => {
    mocks.user = user(null, false);
    mount(<CompletarPerfil />);
    expect(screen.getByRole("status")).toHaveTextContent("Confirme seu e-mail");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(mocks.completeProfile).not.toHaveBeenCalled();
  });
});

describe("AuthCallback", () => {
  it.each([
    ["responsavel", "Destino: prancha"],
    ["fonoaudiologo", "Destino: profissional"],
    [null, "Destino: completar perfil"],
  ] as const)(
    "routes verified %s accounts using the persisted role",
    (role, destination) => {
      mocks.user = user(role);
      mount(<AuthCallback />);
      expect(screen.getByText(destination)).toBeInTheDocument();
    },
  );

  it("routes only verified recovery context to the password page", () => {
    mocks.user = user();
    mocks.isRecovery = true;
    mount(<AuthCallback />);
    expect(screen.getByText("Destino: redefinir senha")).toBeInTheDocument();
  });

  it("does not display raw OAuth errors or grant access after provider cancellation", () => {
    mocks.user = user("fonoaudiologo");
    mount(
      <AuthCallback />,
      "/test?error=access_denied&error_description=private-diagnostic-value",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível concluir o acesso",
    );
    expect(
      screen.queryByText(/private-diagnostic-value/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Destino: profissional")).not.toBeInTheDocument();
  });

  it("does not navigate while the canonical profile cannot be loaded", async () => {
    mocks.user = user("fonoaudiologo");
    mocks.error = "Não foi possível carregar seu perfil.";
    mount(<AuthCallback />);
    expect(screen.queryByText("Destino: profissional")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    });
    expect(mocks.retrySession).toHaveBeenCalledOnce();
  });
});
