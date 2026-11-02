import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthProvider,
  MOCK_AUTH_STORAGE_KEY,
  MOCK_USER,
  useAuth,
} from "./AuthProvider";

const remote = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  configurationError: null,
  supabase: { auth: remote },
}));

beforeEach(() => {
  vi.stubEnv("MODE", "demo");
  vi.useFakeTimers();
  sessionStorage.clear();
  vi.clearAllMocks();
  remote.getSession.mockResolvedValue({ data: { session: null }, error: null });
  remote.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sessionStorage.clear();
});

async function finishLogin() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
}

describe("AuthProvider: autenticação de apresentação", () => {
  it("waits 800ms, ignores credentials and stores only the fictional user", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.isMock).toBe(true);
    expect(result.current.user).toBeNull();
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.signIn(
        "private-input@example.test",
        "ignored-private-password",
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    expect(result.current.user).toBeNull();
    expect(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await operation;
    });
    expect(result.current.user).toEqual(MOCK_USER);
    expect(result.current.session).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)!)).toEqual(
      MOCK_USER,
    );
    expect(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)).not.toContain(
      "private-input",
    );
    expect(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)).not.toContain(
      "password",
    );
    for (const method of Object.values(remote))
      expect(method).not.toHaveBeenCalled();
  });

  it("accepts blank credentials and deduplicates repeated login attempts", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.signIn("", "");
      second = result.current.signIn("", "");
    });
    expect(first).toBe(second);
    expect(vi.getTimerCount()).toBe(1);
    await finishLogin();
    await Promise.all([first, second]);
    expect(result.current.user).toEqual(MOCK_USER);
  });

  it("restores the session after remounting without calling Supabase or adding a delay", async () => {
    const first = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => {
      void first.result.current.signIn("", "");
    });
    await finishLogin();
    first.unmount();
    const next = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(next.result.current.user).toEqual(MOCK_USER);
    expect(next.result.current.loading).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(remote.getSession).not.toHaveBeenCalled();
  });

  it.each([
    "broken-json",
    "null",
    "[]",
    JSON.stringify({ ...MOCK_USER, id: "another-account" }),
    JSON.stringify({ ...MOCK_USER, name: "Another name" }),
    JSON.stringify({ ...MOCK_USER, access_token: "not-a-session" }),
  ])("rejects invalid or altered stored data: %s", (stored) => {
    sessionStorage.setItem(MOCK_AUTH_STORAGE_KEY, stored);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.user).toBeNull();
    expect(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)).toBeNull();
    expect(remote.getSession).not.toHaveBeenCalled();
  });

  it("clears storage and user on logout, preventing restoration", async () => {
    sessionStorage.setItem(MOCK_AUTH_STORAGE_KEY, JSON.stringify(MOCK_USER));
    const first = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await act(async () => first.result.current.signOut());
    expect(first.result.current.user).toBeNull();
    expect(first.result.current.session).toBeNull();
    expect(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)).toBeNull();
    first.unmount();
    expect(
      renderHook(() => useAuth(), { wrapper: AuthProvider }).result.current
        .user,
    ).toBeNull();
    expect(remote.signOut).not.toHaveBeenCalled();
  });

  it("logout cancels a pending sign-in so it cannot restore a logged-out user", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    let failure: unknown;
    act(() => {
      void result.current.signIn("", "").catch((error) => {
        failure = error;
      });
    });
    await act(async () => result.current.signOut());
    await finishLogin();
    expect(failure).toMatchObject({ name: "AbortError" });
    expect(result.current.user).toBeNull();
    expect(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmount cancels a pending timer without storing a session", async () => {
    const { result, unmount } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });
    let failure: unknown;
    act(() => {
      void result.current.signIn("", "").catch((error) => {
        failure = error;
      });
    });
    unmount();
    await finishLogin();
    expect(failure).toMatchObject({ name: "AbortError" });
    expect(sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows memory-only login when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => {
      void result.current.signIn("", "");
    });
    await finishLogin();
    expect(result.current.user).toEqual(MOCK_USER);
    expect(result.current.error).toBeNull();
    expect(remote.signInWithPassword).not.toHaveBeenCalled();
  });

  it("remains reusable after the StrictMode effect cleanup cycle", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <AuthProvider>{children}</AuthProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => {
      void result.current.signIn("", "");
    });
    await finishLogin();
    expect(result.current.user).toEqual(MOCK_USER);
    expect(remote.onAuthStateChange).not.toHaveBeenCalled();
  });

  it("normal mode ignores the mock object and restores only the real session", async () => {
    vi.stubEnv("MODE", "production");
    sessionStorage.setItem(MOCK_AUTH_STORAGE_KEY, JSON.stringify(MOCK_USER));
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isMock).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(remote.getSession).toHaveBeenCalledOnce();
    expect(remote.onAuthStateChange).toHaveBeenCalledOnce();
  });
});
