import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AccountRole, AuthUser } from "./authTypes";
import { AuthContext, type AuthContextValue, type SignUpResult } from "./AuthContext";

export const MOCK_AUTH_STORAGE_KEY = "comunica-demo-auth-v1";
export const MOCK_USER: Readonly<AuthUser> = Object.freeze({
  id: "demo-123",
  name: "Usuário de Demonstração",
  email: "demo@comunica.com",
  role: "responsavel",
  emailConfirmed: true,
});

async function unsupportedInDemo(): Promise<never> {
  throw new Error("Esta operação está disponível somente no acesso real.");
}

function restoreMockUser(): AuthUser | null {
  try {
    const stored = sessionStorage.getItem(MOCK_AUTH_STORAGE_KEY);
    if (stored === null) return null;
    const value: unknown = JSON.parse(stored);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const candidate = value as Record<string, unknown>;
      if (
        Object.keys(candidate).length === 5 &&
        candidate.id === MOCK_USER.id &&
        candidate.name === MOCK_USER.name &&
        candidate.email === MOCK_USER.email &&
        candidate.role === MOCK_USER.role &&
        candidate.emailConfirmed === true
      )
        return { ...MOCK_USER };
    }
    sessionStorage.removeItem(MOCK_AUTH_STORAGE_KEY);
  } catch {
    try {
      sessionStorage.removeItem(MOCK_AUTH_STORAGE_KEY);
    } catch {
      /* Storage is optional. */
    }
  }
  return null;
}

export function MockAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(restoreMockUser);
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const pending = useRef<{
    promise: Promise<void>;
    timer: ReturnType<typeof setTimeout>;
    reject: (reason: unknown) => void;
  } | null>(null);

  const cancelLogin = useCallback(() => {
    if (!pending.current) return;
    const previous = pending.current;
    pending.current = null;
    clearTimeout(previous.timer);
    previous.reject(new DOMException("Login cancelado.", "AbortError"));
  }, []);

  useEffect(() => {
    mounted.current = true;
    lifecycle.current++;
    return () => {
      mounted.current = false;
      lifecycle.current++;
      cancelLogin();
    };
  }, [cancelLogin]);

  const signIn = useCallback(
    (_email: string, _password: string): Promise<void> => {
      if (pending.current) return pending.current.promise;
      if (!mounted.current)
        return Promise.reject(
          new DOMException("Login cancelado.", "AbortError"),
        );
      const revision = lifecycle.current;
      let resolve!: () => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<void>((ok, fail) => {
        resolve = ok;
        reject = fail;
      });
      // Cancellation is observed internally as well as by callers, including
      // when an unmount occurs before a form's awaiting handler can complete.
      void promise.catch(() => {});
      const timer = setTimeout(() => {
        if (
          !mounted.current ||
          lifecycle.current !== revision ||
          pending.current?.promise !== promise
        )
          return;
        pending.current = null;
        const nextUser = { ...MOCK_USER };
        try {
          sessionStorage.setItem(
            MOCK_AUTH_STORAGE_KEY,
            JSON.stringify(nextUser),
          );
        } catch {
          /* A blocked storage still permits this in-memory demonstration. */
        }
        setUser(nextUser);
        resolve();
      }, 800);
      pending.current = { promise, timer, reject };
      return promise;
    },
    [],
  );

  const signUp = useCallback(
    async (
      _nome: string,
      email: string,
      password: string,
      _consent: boolean,
      _role: AccountRole,
    ): Promise<SignUpResult> => {
      await signIn(email, password);
      return "signed-in";
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    cancelLogin();
    try {
      sessionStorage.removeItem(MOCK_AUTH_STORAGE_KEY);
    } catch {
      /* Storage is optional. */
    }
    if (mounted.current) setUser(null);
  }, [cancelLogin]);

  const retrySession = useCallback(async () => {
    if (mounted.current) setUser(restoreMockUser());
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isMock: true,
      session: null,
      loading: false,
      error: null,
      isRecovery: false,
      signIn,
      signUp,
      signOut,
      retrySession,
      signInWithGoogle: unsupportedInDemo,
      resetPassword: unsupportedInDemo,
      updatePassword: unsupportedInDemo,
      completeProfile: unsupportedInDemo,
    }),
    [user, signIn, signUp, signOut, retrySession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
