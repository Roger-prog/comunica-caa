import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";
import { assertPasswordUpdateToken } from "./passwordMutation";
import {
  clearRecoverySession,
  RECOVERY_STORAGE_KEY,
  RECOVERY_TTL_MS,
} from "./recoverySession";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  signInWithOAuth: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  from: vi.fn(),
  query: vi.fn(),
  rpc: vi.fn(),
  state: {
    callback: null as
      ((event: AuthChangeEvent, session: Session | null) => void) | null,
  },
}));

vi.mock("../lib/supabase", () => ({
  configurationError: null,
  supabase: {
    auth: {
      initialize: mocks.initialize,
      getSession: mocks.getSession,
      getUser: mocks.getUser,
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      signOut: mocks.signOut,
      signInWithOAuth: mocks.signInWithOAuth,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      updateUser: mocks.updateUser,
      onAuthStateChange: mocks.onAuthStateChange,
    },
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}

function sessionFor(id: string): Session {
  return {
    access_token: `test-token-${id}`,
    refresh_token: "test-only-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id,
      email: `${id}@example.test`,
      email_confirmed_at: "2026-01-01T00:00:00Z",
      app_metadata: {},
      user_metadata: { nome: "Untrusted name", role: "fonoaudiologo" },
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

function emit(event: AuthChangeEvent, session: Session | null) {
  act(() => {
    expect(mocks.state.callback?.(event, session)).toBeUndefined();
  });
}

beforeEach(() => {
  vi.stubEnv("MODE", "production");
  vi.clearAllMocks();
  sessionStorage.clear();
  clearRecoverySession();
  window.history.replaceState({}, "", "/login");
  mocks.initialize.mockReset().mockResolvedValue({ error: null });
  mocks.getSession
    .mockReset()
    .mockResolvedValue({ data: { session: null }, error: null });
  mocks.getUser.mockReset().mockImplementation(async (token: string) => {
    const id = token.replace("test-token-", "");
    return { data: { user: sessionFor(id).user }, error: null };
  });
  mocks.query.mockReset().mockImplementation(async (id: string) => ({
    data: { id, nome: `Nome ${id}`, role: "responsavel" },
    error: null,
  }));
  mocks.from.mockReset().mockImplementation(() => {
    let id = "";
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((_column: string, value: string) => {
        id = value;
        return builder;
      }),
      abortSignal: vi.fn(() => builder),
      maybeSingle: vi.fn(() => mocks.query(id)),
    };
    return builder;
  });
  for (const method of [
    mocks.signInWithPassword,
    mocks.signInWithOAuth,
    mocks.resetPasswordForEmail,
    mocks.updateUser,
    mocks.signOut,
    mocks.rpc,
  ])
    method.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.signUp
    .mockReset()
    .mockResolvedValue({ data: { session: null, user: null }, error: null });
  mocks.state.callback = null;
  mocks.onAuthStateChange.mockReset().mockImplementation((callback) => {
    mocks.state.callback = callback;
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
  });
});

afterEach(() => {
  cleanup();
  clearRecoverySession();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

async function mountSignedIn(id = "alice") {
  mocks.getSession.mockResolvedValueOnce({
    data: { session: sessionFor(id) },
    error: null,
  });
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("AuthProvider: identidade e perfil canônico", () => {
  it("loads identity from getUser and the role/name only from caa_profiles", async () => {
    const { result } = await mountSignedIn();
    expect(result.current.user).toEqual({
      id: "alice",
      name: "Nome alice",
      email: "alice@example.test",
      role: "responsavel",
      emailConfirmed: true,
    });
    expect(mocks.getUser).toHaveBeenCalledWith("test-token-alice");
    expect(mocks.from).toHaveBeenCalledWith("caa_profiles");
    expect(result.current.user?.role).not.toBe("fonoaudiologo");
  });

  it("does not replace a newer session with an obsolete restoration response", async () => {
    const restoration = deferred<{
      data: { session: Session | null };
      error: null;
    }>();
    mocks.getSession.mockReturnValueOnce(restoration.promise);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalledOnce());
    emit("SIGNED_IN", sessionFor("newer"));
    await waitFor(() => expect(result.current.user?.id).toBe("newer"));
    await act(async () => {
      restoration.resolve({
        data: { session: sessionFor("obsolete") },
        error: null,
      });
      await restoration.promise;
    });
    expect(result.current.user?.id).toBe("newer");
    expect(result.current.session?.user.id).toBe("newer");
  });

  it("blocks access while the role loads and ignores a previous account's late profile", async () => {
    const oldProfile = deferred<{
      data: { id: string; nome: string; role: string };
      error: null;
    }>();
    mocks.query.mockImplementation(async (id) =>
      id === "old"
        ? oldProfile.promise
        : {
            data: { id, nome: `Nome ${id}`, role: "fonoaudiologo" },
            error: null,
          },
    );
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    emit("SIGNED_IN", sessionFor("old"));
    await waitFor(() => expect(mocks.query).toHaveBeenCalledWith("old"));
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.user).toBeNull();
    emit("SIGNED_IN", sessionFor("new"));
    await waitFor(() => expect(hook.result.current.user?.id).toBe("new"));
    await act(async () => {
      oldProfile.resolve({
        data: { id: "old", nome: "Old name", role: "responsavel" },
        error: null,
      });
      await oldProfile.promise;
    });
    expect(hook.result.current.user?.id).toBe("new");
    expect(hook.result.current.user?.role).toBe("fonoaudiologo");
  });

  it("fails closed if the profile is missing and retries the same session safely", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: sessionFor("alice") },
      error: null,
    });
    mocks.query.mockResolvedValueOnce({
      data: null,
      error: { message: "PRIVATE_DATABASE_DIAGNOSTIC" },
    });
    const { result } = await mountSignedIn();
    expect(result.current.user).toBeNull();
    expect(result.current.error).toContain("carregar o perfil");
    expect(result.current.error).not.toContain("PRIVATE_DATABASE_DIAGNOSTIC");
    await act(async () => {
      await result.current.retrySession();
    });
    await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  });

  it("does not trust a local identity when getUser verifies a different user", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: sessionFor("different").user },
      error: null,
    });
    const { result } = await mountSignedIn();
    expect(result.current.user).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("requires the verified user's email confirmation instead of trusting the stored session", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: {
        user: { ...sessionFor("alice").user, email_confirmed_at: undefined },
      },
      error: null,
    });
    const { result } = await mountSignedIn();
    expect(result.current.user?.emailConfirmed).toBe(false);
  });

  it("retains a null role for the verified OAuth onboarding flow", async () => {
    mocks.query.mockResolvedValueOnce({
      data: { id: "alice", nome: "Alice", role: null },
      error: null,
    });
    const { result } = await mountSignedIn();
    expect(result.current.user?.role).toBeNull();
    expect(result.current.user?.emailConfirmed).toBe(true);
  });

  it("completes the profile through the scoped RPC and reloads the canonical role", async () => {
    mocks.query.mockResolvedValueOnce({
      data: { id: "alice", nome: "Alice", role: null },
      error: null,
    });
    const { result } = await mountSignedIn();
    mocks.query.mockResolvedValueOnce({
      data: { id: "alice", nome: "Alice Fono", role: "fonoaudiologo" },
      error: null,
    });
    await act(async () => {
      await result.current.completeProfile(
        "fonoaudiologo",
        " Alice Fono ",
        true,
      );
    });
    expect(mocks.rpc).toHaveBeenCalledWith("complete_caa_profile", {
      p_role: "fonoaudiologo",
      p_nome: "Alice Fono",
      p_consent: true,
      p_expected_user_id: "alice",
    });
    expect(result.current.user?.role).toBe("fonoaudiologo");
    expect(result.current.user?.name).toBe("Alice Fono");
  });

  it("clears identity after successful logout and prevents a late profile from restoring it", async () => {
    const pending = deferred<{
      data: { id: string; nome: string; role: string };
      error: null;
    }>();
    mocks.query.mockReturnValueOnce(pending.promise);
    mocks.getSession.mockResolvedValueOnce({
      data: { session: sessionFor("alice") },
      error: null,
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(mocks.query).toHaveBeenCalledOnce());
    await act(async () => {
      await result.current.signOut();
    });
    await act(async () => {
      pending.resolve({
        data: { id: "alice", nome: "Alice", role: "responsavel" },
        error: null,
      });
      await pending.promise;
    });
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("unsubscribes and ignores pending restoration after unmount", async () => {
    const restoration = deferred<{
      data: { session: Session | null };
      error: null;
    }>();
    mocks.getSession.mockReturnValueOnce(restoration.promise);
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalledOnce());
    const callback = mocks.state.callback;
    hook.unmount();
    await act(async () => {
      callback?.("SIGNED_IN", sessionFor("late"));
      restoration.resolve({
        data: { session: sessionFor("late") },
        error: null,
      });
      await restoration.promise;
    });
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(hook.result.current.session).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("restores and verifies one usable identity after a StrictMode cleanup cycle", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: sessionFor("alice") },
      error: null,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <AuthProvider>{children}</AuthProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.id).toBe("alice"));
    expect(result.current.loading).toBe(false);
  });
});

describe("AuthProvider: cadastro, e-mail e Google", () => {
  it("sends the chosen registration role and callback URL, then requires confirmation without a session", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.signUp(
        " Maria ",
        " maria@example.test ",
        "test-password-only",
        true,
        "fonoaudiologo",
      );
    });
    expect(outcome).toBe("confirmation-required");
    expect(result.current.user).toBeNull();
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "maria@example.test",
      password: "test-password-only",
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          nome: "Maria",
          name: "Maria",
          role: "fonoaudiologo",
          consent: true,
        },
      },
    });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    { consent: false, role: "responsavel", expected: "Confirme o aviso" },
    {
      consent: true,
      role: "administrator",
      expected: "Escolha o tipo de conta",
    },
  ])(
    "rejects invalid registration before remote auth: $role / $consent",
    async ({ consent, role, expected }) => {
      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
      await waitFor(() => expect(result.current.loading).toBe(false));
      await expect(
        result.current.signUp(
          "Maria",
          "maria@example.test",
          "test-password-only",
          consent,
          role as "responsavel",
        ),
      ).rejects.toThrow(expected);
      expect(mocks.signUp).not.toHaveBeenCalled();
    },
  );

  it("starts Google OAuth with the fixed same-origin PKCE callback", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signInWithGoogle();
    });
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  });

  it("uses resetPasswordForEmail with the dedicated password page", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.resetPassword(" alice@example.test ");
    });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      "alice@example.test",
      {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      },
    );
  });

  it.each([
    {
      cause: {
        name: "AuthRetryableFetchError",
        message: "network PRIVATE_DIAGNOSTIC password=DO_NOT_EXPOSE",
      },
      expected: "Verifique sua conexão",
    },
    {
      cause: {
        code: "over_email_send_rate_limit",
        message: "PRIVATE_DIAGNOSTIC",
      },
      expected: "limite de envio",
    },
    {
      cause: { code: "over_request_rate_limit", message: "PRIVATE_DIAGNOSTIC" },
      expected: "Muitas tentativas",
    },
    {
      cause: { code: "email_not_confirmed", message: "PRIVATE_DIAGNOSTIC" },
      expected: "Confirme seu e-mail",
    },
  ])(
    "sanitizes authentication errors: $expected",
    async ({ cause, expected }) => {
      mocks.signInWithPassword.mockResolvedValueOnce({
        data: { session: null },
        error: cause,
      });
      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await expect(
          result.current.signIn("alice@example.test", "test-password-only"),
        ).rejects.toThrow(expected);
      });
      expect(result.current.error).toContain(expected);
      expect(result.current.error).not.toContain("PRIVATE_DIAGNOSTIC");
      expect(result.current.error).not.toContain("DO_NOT_EXPOSE");
    },
  );
});

describe("AuthProvider: recuperação verificada", () => {
  it("does not authorize recovery from a URL flag and an ordinary authenticated session", async () => {
    window.history.replaceState(
      {},
      "",
      "/redefinir-senha?type=recovery#type=recovery",
    );
    const { result } = await mountSignedIn();
    expect(result.current.isRecovery).toBe(false);
    await expect(
      result.current.updatePassword("test-new-password-only"),
    ).rejects.toThrow("link válido");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("captures PASSWORD_RECOVERY, changes the credential and clears only the recovery state", async () => {
    const { result } = await mountSignedIn();
    emit("PASSWORD_RECOVERY", sessionFor("alice"));
    expect(result.current.isRecovery).toBe(true);
    expect(
      JSON.parse(sessionStorage.getItem(RECOVERY_STORAGE_KEY)!),
    ).toMatchObject({ version: 1, userId: "alice" });
    await act(async () => {
      await result.current.updatePassword("test-new-password-only");
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: "test-new-password-only",
    });
    expect(sessionStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
    expect(result.current.isRecovery).toBe(false);
    expect(result.current.session?.user.id).toBe("alice");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("allows verified recovery even when the application's profile cannot be loaded", async () => {
    mocks.query.mockResolvedValue({
      data: null,
      error: { code: "profile_not_ready" },
    });
    const { result } = await mountSignedIn();
    expect(result.current.user).toBeNull();
    emit("PASSWORD_RECOVERY", sessionFor("alice"));
    await act(async () => {
      await result.current.updatePassword("test-new-password-only");
    });
    expect(mocks.updateUser).toHaveBeenCalledOnce();
  });

  it("restores an active recovery marker only for the same verified session", async () => {
    const first = await mountSignedIn();
    emit("PASSWORD_RECOVERY", sessionFor("alice"));
    first.unmount();
    const second = await mountSignedIn();
    expect(second.result.current.isRecovery).toBe(true);
    second.unmount();
    const third = await mountSignedIn("bob");
    expect(third.result.current.isRecovery).toBe(false);
    expect(sessionStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it("expires recovery automatically and rejects a later password change", async () => {
    const { result } = await mountSignedIn();
    vi.useFakeTimers();
    emit("PASSWORD_RECOVERY", sessionFor("alice"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_TTL_MS);
    });
    expect(result.current.isRecovery).toBe(false);
    await expect(
      result.current.updatePassword("test-new-password-only"),
    ).rejects.toThrow("link válido");
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it("rechecks the session before saving and never updates another account", async () => {
    const { result } = await mountSignedIn();
    emit("PASSWORD_RECOVERY", sessionFor("alice"));
    mocks.getUser.mockResolvedValueOnce({
      data: { user: sessionFor("bob").user },
      error: null,
    });
    await act(async () => {
      await expect(
        result.current.updatePassword("test-new-password-only"),
      ).rejects.toThrow("Sua sessão expirou");
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("binds updateUser's final transport to the recovery session token", async () => {
    const { result } = await mountSignedIn();
    emit("PASSWORD_RECOVERY", sessionFor("alice"));
    const send = vi.fn();
    mocks.updateUser.mockImplementationOnce(async () => {
      assertPasswordUpdateToken("https://example.supabase.co/auth/v1/user", {
        method: "PUT",
        headers: { Authorization: "Bearer test-token-another-session" },
      });
      send();
      return { data: {}, error: null };
    });
    await act(async () => {
      await expect(
        result.current.updatePassword("test-new-password-only"),
      ).rejects.toThrow("Sua sessão mudou");
    });
    expect(send).not.toHaveBeenCalled();
    expect(result.current.isRecovery).toBe(true);
  });

  it("retains a verified recovery after a rejected password so the user can retry", async () => {
    const { result } = await mountSignedIn();
    emit("PASSWORD_RECOVERY", sessionFor("alice"));
    mocks.updateUser.mockResolvedValueOnce({
      data: {},
      error: { code: "same_password" },
    });
    await act(async () => {
      await expect(
        result.current.updatePassword("test-new-password-only"),
      ).rejects.toThrow("senha diferente");
    });
    expect(result.current.isRecovery).toBe(true);
    await act(async () => {
      await result.current.updatePassword("another-test-password");
    });
    expect(result.current.isRecovery).toBe(false);
  });

  it("reports an invalid PKCE callback without exposing its diagnostics or accepting an old marker", async () => {
    sessionStorage.setItem(
      RECOVERY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        userId: "alice",
        expiresAt: Date.now() + RECOVERY_TTL_MS,
      }),
    );
    mocks.initialize.mockResolvedValueOnce({
      error: {
        code: "flow_state_expired",
        message: "PRIVATE_CALLBACK_DIAGNOSTIC",
      },
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain("inválido ou expirou");
    expect(result.current.error).not.toContain("PRIVATE_CALLBACK_DIAGNOSTIC");
    expect(result.current.isRecovery).toBe(false);
    expect(sessionStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("never releases an old INITIAL_SESSION while the PKCE callback is still unvalidated", async () => {
    const initialization = deferred<{
      error: { code: string; message: string } | null;
    }>();
    mocks.initialize.mockReturnValueOnce(initialization.promise);
    window.history.replaceState(
      {},
      "",
      "/auth/callback?code=invalid-test-code",
    );
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    emit("INITIAL_SESSION", sessionFor("old-session"));
    await waitFor(() =>
      expect(mocks.query).toHaveBeenCalledWith("old-session"),
    );
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
    await act(async () => {
      initialization.resolve({
        error: {
          code: "bad_code_verifier",
          message: "PRIVATE_CALLBACK_DIAGNOSTIC",
        },
      });
      await initialization.promise;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.error).toContain("inválido ou expirou");
    emit("INITIAL_SESSION", sessionFor("old-session"));
    expect(result.current.session).toBeNull();
    expect(result.current.error).toContain("inválido ou expirou");
  });

  it("rejects a callback code left unconsumed when there is no PKCE verifier", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback?code=unconsumed-test-code",
    );
    mocks.getSession.mockResolvedValueOnce({
      data: { session: sessionFor("old-session") },
      error: null,
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.error).toContain("inválido ou expirou");
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
