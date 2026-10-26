import { act, renderHook, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  state: {
    callback: null as
      ((event: AuthChangeEvent, session: Session | null) => void) | null,
  },
}));

vi.mock("../lib/supabase", () => ({
  configurationError: null,
  supabase: {
    auth: {
      getSession: mocks.getSession,
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      signOut: mocks.signOut,
      onAuthStateChange: mocks.onAuthStateChange,
    },
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function sessionFor(id: string): Session {
  return {
    access_token: "test-only-access-token",
    refresh_token: "test-only-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("AuthProvider", () => {
  beforeEach(() => {
    mocks.getSession
      .mockReset()
      .mockResolvedValue({ data: { session: null }, error: null });
    mocks.signInWithPassword.mockReset();
    mocks.signUp.mockReset();
    mocks.signOut.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.state.callback = null;
    mocks.onAuthStateChange.mockReset().mockImplementation((callback) => {
      mocks.state.callback = callback;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });
  });

  it("does not replace a newer SIGNED_IN session with an obsolete getSession response", async () => {
    const restoration = deferred<{
      data: { session: Session | null };
      error: null;
    }>();
    mocks.getSession.mockReturnValueOnce(restoration.promise);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.loading).toBe(true);

    const signedInSession = sessionFor("newer-user");
    act(() => {
      const returned = mocks.state.callback?.("SIGNED_IN", signedInSession);
      expect(returned).toBeUndefined();
    });
    expect(result.current.session).toBe(signedInSession);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      restoration.resolve({
        data: { session: sessionFor("obsolete-user") },
        error: null,
      });
      await restoration.promise;
    });
    expect(result.current.session).toBe(signedInSession);
    expect(result.current.error).toBeNull();
  });

  it("requires email confirmation when signUp returns no session and never simulates a login", async () => {
    mocks.signUp.mockResolvedValue({
      data: { session: null, user: { id: "pending-user" } },
      error: null,
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.signUp(
        " Maria ",
        " maria@example.test ",
        "test-password-only",
        true,
      );
    });

    expect(outcome).toBe("confirmation-required");
    expect(result.current.session).toBeNull();
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "maria@example.test",
      password: "test-password-only",
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          nome: "Maria",
          name: "Maria",
          role: "responsavel",
          consent: true,
        },
      },
    });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects registration without acknowledgement before calling the remote auth client", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(
      result.current.signUp(
        "Maria",
        "maria@example.test",
        "test-password-only",
        false,
      ),
    ).rejects.toThrow("Confirme o aviso de armazenamento de dados");
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "network failure",
      cause: {
        name: "AuthRetryableFetchError",
        status: 0,
        message:
          "Network failure: password=DO_NOT_EXPOSE, token=PRIVATE_DIAGNOSTIC",
      },
      expected: "Verifique sua conexão e tente novamente",
    },
    {
      name: "email delivery rate limit",
      cause: {
        code: "over_email_send_rate_limit",
        status: 429,
        message: "SMTP PRIVATE_DIAGNOSTIC password=DO_NOT_EXPOSE",
      },
      expected: "O limite de envio de e-mails foi atingido",
    },
    {
      name: "request rate limit",
      cause: {
        code: "over_request_rate_limit",
        status: 429,
        message: "PRIVATE_DIAGNOSTIC password=DO_NOT_EXPOSE",
      },
      expected: "Muitas tentativas em pouco tempo",
    },
  ])(
    "sanitizes $name without exposing credential diagnostics",
    async ({ cause, expected }) => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: cause,
      });
      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await expect(
          result.current.signIn("maria@example.test", "test-password-only"),
        ).rejects.toThrow(expected);
      });
      expect(result.current.error).toContain(expected);
      expect(result.current.error).not.toContain("DO_NOT_EXPOSE");
      expect(result.current.error).not.toContain("PRIVATE_DIAGNOSTIC");
      expect(result.current.session).toBeNull();
    },
  );

  it("unsubscribes on cleanup and ignores the old callback and pending restoration", async () => {
    const restoration = deferred<{
      data: { session: Session | null };
      error: null;
    }>();
    mocks.getSession.mockReturnValueOnce(restoration.promise);
    const { result, unmount } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });
    const obsoleteCallback = mocks.state.callback;
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();

    await act(async () => {
      expect(
        obsoleteCallback?.("SIGNED_IN", sessionFor("unmounted-user")),
      ).toBeUndefined();
      restoration.resolve({
        data: { session: sessionFor("unmounted-user") },
        error: null,
      });
      await restoration.promise;
    });
    expect(result.current.session).toBeNull();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
