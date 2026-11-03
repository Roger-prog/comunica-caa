import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { configurationError, supabase } from "../lib/supabase";
import { isMockAuthMode } from "./authMode";
import { isAccountRole, type AccountRole, type AuthUser } from "./authTypes";
import { withPasswordUpdateToken } from "./passwordMutation";
import { SignupEmailError } from "./signupEmail";
import {
  clearRecoverySession,
  readRecoverySession,
  recordRecoverySession,
} from "./recoverySession";

export type { AccountRole, AuthUser } from "./authTypes";

type SignUpResult = "signed-in" | "confirmation-required";

export interface AuthContextValue {
  user: AuthUser | null;
  isMock: boolean;
  session: Session | null;
  loading: boolean;
  error: string | null;
  isRecovery: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    nome: string,
    email: string,
    password: string,
    consent: boolean,
    role: AccountRole,
  ) => Promise<SignUpResult>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  completeProfile: (
    role: AccountRole,
    nome: string,
    consent: boolean,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  retrySession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

export const MOCK_AUTH_STORAGE_KEY = "comunica-demo-auth-v1";
export const MOCK_USER: Readonly<AuthUser> = Object.freeze({
  id: "demo-123",
  name: "Usuário de Demonstração",
  email: "demo@comunica.com",
  role: "responsavel",
  emailConfirmed: true,
});

// Subscribe during module evaluation: URL recovery can complete before React
// mounts. This observer records only the SDK event and never calls auth methods.
const earlyRecoverySubscription =
  !isMockAuthMode() && supabase
    ? supabase.auth.onAuthStateChange((event, nextSession) => {
        if (event === "PASSWORD_RECOVERY" && nextSession)
          recordRecoverySession(nextSession);
        if (event === "SIGNED_OUT") clearRecoverySession();
      })
    : null;
import.meta.hot?.dispose(() => {
  earlyRecoverySubscription?.data.subscription.unsubscribe();
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

function MockAuthProvider({ children }: { children: ReactNode }) {
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

/** Never expose server diagnostics, credentials or tokens in the interface. */
export function authErrorMessage(error: unknown): string {
  const detail =
    error && typeof error === "object"
      ? (error as {
          code?: string;
          name?: string;
          message?: string;
          status?: number;
        })
      : {};
  const message = detail.message?.toLowerCase() ?? "";

  if (
    detail.code === "session_changed" ||
    message ===
      "sua sessão mudou. abra novamente o link de recuperação para continuar."
  )
    return "Sua sessão mudou. Abra novamente o link de recuperação para continuar.";

  if (
    detail.name === "AuthRetryableFetchError" ||
    detail.name === "TypeError" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("load failed") ||
    (detail.status !== undefined && detail.status >= 500)
  ) {
    return "Não foi possível conectar ao serviço de autenticação. Verifique sua conexão e tente novamente. Se persistir, contate o responsável pelo sistema.";
  }

  switch (detail.code) {
    case "invalid_credentials":
      return "E-mail ou senha incorretos.";
    case "email_not_confirmed":
      return "Confirme seu e-mail pelo link recebido antes de entrar.";
    case "over_email_send_rate_limit":
      return "O limite de envio de e-mails foi atingido. Aguarde e tente novamente ou contate o administrador do sistema.";
    case "over_request_rate_limit":
      return "Muitas tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente.";
    case "weak_password":
      return "Escolha uma senha mais forte, com pelo menos 10 caracteres.";
    case "signup_disabled":
      return "O cadastro está indisponível no momento. Contate o administrador do sistema.";
    case "user_already_exists":
    case "email_exists":
      return "Não foi possível concluir o cadastro com esses dados. Se já possui uma conta, tente entrar.";
    case "email_address_invalid":
    case "validation_failed":
      return "Verifique se os dados informados são válidos.";
    case "captcha_failed":
      return "A verificação de segurança não foi concluída. Contate o administrador para verificar a configuração do formulário.";
    case "refresh_token_not_found":
    case "refresh_token_already_used":
    case "session_not_found":
      return "Sua sessão expirou. Entre novamente para continuar.";
    case "otp_expired":
    case "otp_disabled":
    case "bad_code_verifier":
    case "flow_state_not_found":
    case "flow_state_expired":
    case "pkce_verifier_not_found":
      return "O link de acesso é inválido ou expirou. Solicite um novo link e abra-o no mesmo navegador.";
    case "same_password":
      return "Escolha uma senha diferente da senha atual.";
    case "provider_disabled":
    case "oauth_provider_not_supported":
      return "O acesso com Google não está disponível. Use e-mail e senha ou contate o responsável pelo sistema.";
    default:
      return "Não foi possível concluir a autenticação. Tente novamente em alguns instantes.";
  }
}

function requireClient() {
  if (!supabase) {
    throw new Error(
      configurationError ??
        "Configure a conexão com o Supabase para autenticar.",
    );
  }
  return supabase;
}

function validateProfileInput(nome: string, consent: boolean, role: unknown) {
  if (!nome.trim() || nome.trim().length > 80)
    throw new Error("Informe seu nome, com até 80 caracteres.");
  if (!isAccountRole(role))
    throw new Error("Escolha o tipo de conta: Responsável ou Fonoaudiólogo.");
  if (!consent)
    throw new Error(
      "Confirme o aviso de armazenamento de dados para criar sua conta.",
    );
}

async function fetchCanonicalUser(
  client: NonNullable<typeof supabase>,
  session: Session,
  signal?: AbortSignal,
): Promise<AuthUser> {
  const verified = await client.auth.getUser(session.access_token);
  if (signal?.aborted)
    throw new DOMException("Operação cancelada.", "AbortError");
  if (
    verified.error ||
    !verified.data.user ||
    verified.data.user.id !== session.user.id
  )
    throw new Error("Não foi possível verificar sua sessão. Entre novamente.");
  const { data, error } = await client
    .from("caa_profiles")
    .select("id,nome,role")
    .eq("id", verified.data.user.id)
    .abortSignal(signal ?? new AbortController().signal)
    .maybeSingle();
  if (
    error ||
    !data ||
    data.id !== verified.data.user.id ||
    typeof data.nome !== "string" ||
    !data.nome.trim() ||
    !(data.role === null || isAccountRole(data.role))
  )
    throw new Error(
      "Não foi possível carregar o perfil da conta. Tente novamente.",
    );
  return {
    id: verified.data.user.id,
    name: data.nome,
    email: verified.data.user.email ?? "",
    role: data.role,
    emailConfirmed: Boolean(verified.data.user.email_confirmed_at),
  };
}

function hasCallbackError(): boolean {
  if (
    !["/auth/callback", "/redefinir-senha"].includes(window.location.pathname)
  )
    return false;
  return [window.location.search.slice(1), window.location.hash.slice(1)].some(
    (part) => {
      const parameters = new URLSearchParams(part);
      return (
        parameters.has("error") ||
        parameters.has("error_code") ||
        parameters.has("code") ||
        parameters.has("access_token")
      );
    },
  );
}

type ProfileState = {
  key: string;
  status: "loading" | "ready" | "error";
  user: AuthUser | null;
  error: string | null;
};

function RealAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [restoring, setRestoring] = useState(Boolean(supabase));
  const [authError, setAuthError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileState>({
    key: "",
    status: "ready",
    user: null,
    error: null,
  });
  const [profileRevision, setProfileRevision] = useState(0);
  const [recoveryUntil, setRecoveryUntil] = useState<number | null>(null);
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const authRevision = useRef(0);
  const restoration = useRef(0);
  const initializationPending = useRef(Boolean(supabase));
  const callbackInvalid = useRef(false);
  const authIntent = useRef(0);
  const sessionKey = session
    ? `${session.user.id}:${session.access_token}`
    : "";

  const acceptSession = useCallback((nextSession: Session | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    setRecoveryUntil(
      nextSession
        ? (readRecoverySession(nextSession.user.id)?.expiresAt ?? null)
        : null,
    );
  }, []);

  const retrySession = useCallback(async () => {
    if (!supabase) {
      setAuthError(configurationError);
      setRestoring(false);
      return;
    }
    const request = ++restoration.current;
    const currentLifecycle = lifecycle.current;
    const revision = authRevision.current;
    const intent = authIntent.current;
    let awaitingInitialization = true;
    initializationPending.current = true;
    setRestoring(true);
    setAuthError(null);
    try {
      // Initialization reports invalid/expired PKCE links; getSession alone
      // may still return an unrelated, previously persisted session.
      const initialization = await supabase.auth.initialize?.();
      if (
        !mounted.current ||
        lifecycle.current !== currentLifecycle ||
        restoration.current !== request ||
        authIntent.current !== intent
      )
        return;
      if (
        (initialization?.error && intent === 0) ||
        hasCallbackError() ||
        callbackInvalid.current
      ) {
        callbackInvalid.current = true;
        clearRecoverySession();
        setRecoveryUntil(null);
        acceptSession(null);
        setAuthError(
          authErrorMessage(initialization?.error ?? { code: "otp_expired" }),
        );
        return;
      }
      awaitingInitialization = false;
      initializationPending.current = false;
      if (authRevision.current !== revision) return;
      const { data, error } = await supabase.auth.getSession();
      if (
        !mounted.current ||
        lifecycle.current !== currentLifecycle ||
        restoration.current !== request ||
        authRevision.current !== revision
      )
        return;
      if (error) throw error;
      acceptSession(data.session);
      setProfileRevision((previous) => previous + 1);
    } catch (cause) {
      if (
        mounted.current &&
        lifecycle.current === currentLifecycle &&
        restoration.current === request &&
        authIntent.current === intent &&
        (awaitingInitialization || authRevision.current === revision)
      ) {
        if (awaitingInitialization) {
          callbackInvalid.current = true;
          clearRecoverySession();
          acceptSession(null);
        }
        setAuthError(authErrorMessage(cause));
      }
    } finally {
      if (
        mounted.current &&
        lifecycle.current === currentLifecycle &&
        restoration.current === request
      ) {
        initializationPending.current = false;
        setRestoring(false);
      }
    }
  }, [acceptSession]);

  useEffect(() => {
    mounted.current = true;
    const currentLifecycle = ++lifecycle.current;
    if (!supabase) {
      setRestoring(false);
      return () => {
        mounted.current = false;
        lifecycle.current++;
      };
    }
    // Keep callbacks synchronous. Verified identity and profile queries run
    // in the effect below, outside the client's auth notification lifecycle.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted.current || lifecycle.current !== currentLifecycle) return;
      if (event === "SIGNED_OUT") clearRecoverySession();
      if (callbackInvalid.current) {
        if (event === "SIGNED_OUT") acceptSession(null);
        return;
      }
      authRevision.current++;
      if (event === "PASSWORD_RECOVERY" && nextSession)
        recordRecoverySession(nextSession);
      acceptSession(nextSession);
      setAuthError(null);
      if (!initializationPending.current) setRestoring(false);
    });
    void retrySession();
    return () => {
      mounted.current = false;
      lifecycle.current++;
      restoration.current++;
      subscription.unsubscribe();
    };
  }, [acceptSession, retrySession]);

  useEffect(() => {
    if (!session || !supabase) {
      setProfile({ key: "", status: "ready", user: null, error: null });
      return;
    }
    const controller = new AbortController();
    const currentSession = session;
    setProfile({ key: sessionKey, status: "loading", user: null, error: null });
    void fetchCanonicalUser(supabase, currentSession, controller.signal)
      .then((user) => {
        if (!controller.signal.aborted && mounted.current)
          setProfile({ key: sessionKey, status: "ready", user, error: null });
      })
      .catch(() => {
        if (!controller.signal.aborted && mounted.current)
          setProfile({
            key: sessionKey,
            status: "error",
            user: null,
            error:
              "Não foi possível carregar o perfil da conta. Tente novamente.",
          });
      });
    return () => controller.abort();
  }, [sessionKey, profileRevision]);

  useEffect(() => {
    if (recoveryUntil === null) return;
    const timer = setTimeout(
      () => {
        clearRecoverySession();
        setRecoveryUntil(null);
      },
      Math.max(0, recoveryUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [recoveryUntil]);

  const reportAuthFailure = useCallback((cause: unknown): never => {
    const message = authErrorMessage(cause);
    if (mounted.current) setAuthError(message);
    throw new Error(message);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const client = requireClient();
      authIntent.current++;
      callbackInvalid.current = false;
      clearRecoverySession();
      setRecoveryUntil(null);
      setAuthError(null);
      try {
        const { error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      } catch (cause) {
        reportAuthFailure(cause);
      }
    },
    [reportAuthFailure],
  );

  const signUp = useCallback(
    async (
      nome: string,
      email: string,
      password: string,
      consent: boolean,
      role: AccountRole,
    ): Promise<SignUpResult> => {
      const client = requireClient();
      validateProfileInput(nome, consent, role);
      if (password.length < 10)
        throw new Error("A senha deve ter pelo menos 10 caracteres.");
      authIntent.current++;
      callbackInvalid.current = false;
      setAuthError(null);
      try {
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: { nome: nome.trim(), name: nome.trim(), role, consent: true },
          },
        });
        if (error) throw error;
        return data.session && data.session.user.email_confirmed_at
          ? "signed-in"
          : "confirmation-required";
      } catch (cause) {
        const emailError = SignupEmailError.from(cause);
        if (emailError) throw emailError;
        return reportAuthFailure(cause);
      }
    },
    [reportAuthFailure],
  );

  const signInWithGoogle = useCallback(async () => {
    const client = requireClient();
    authIntent.current++;
    callbackInvalid.current = false;
    clearRecoverySession();
    setRecoveryUntil(null);
    setAuthError(null);
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch (cause) {
      reportAuthFailure(cause);
    }
  }, [reportAuthFailure]);

  const resetPassword = useCallback(
    async (email: string) => {
      const client = requireClient();
      if (!email.trim())
        throw new Error("Informe seu e-mail para recuperar a senha.");
      setAuthError(null);
      try {
        const { error } = await client.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: `${window.location.origin}/redefinir-senha`,
          },
        );
        if (error) throw error;
      } catch (cause) {
        reportAuthFailure(cause);
      }
    },
    [reportAuthFailure],
  );

  const updatePassword = useCallback(
    async (password: string) => {
      const client = requireClient();
      const current = sessionRef.current;
      if (
        initializationPending.current ||
        callbackInvalid.current ||
        !current ||
        !readRecoverySession(current.user.id)
      )
        throw new Error(
          "Abra um link válido de recuperação recebido por e-mail para redefinir sua senha.",
        );
      if (password.length < 10)
        throw new Error("A senha deve ter pelo menos 10 caracteres.");
      setAuthError(null);
      try {
        const verified = await client.auth.getUser(current.access_token);
        if (
          verified.error ||
          verified.data.user?.id !== current.user.id ||
          sessionRef.current?.user.id !== current.user.id ||
          !readRecoverySession(current.user.id)
        )
          throw { code: "session_not_found" };
        const { error } = await withPasswordUpdateToken(
          current.access_token,
          () => client.auth.updateUser({ password }),
        );
        if (error) throw error;
        if (
          mounted.current &&
          sessionRef.current?.user.id === current.user.id
        ) {
          clearRecoverySession();
          setRecoveryUntil(null);
        }
      } catch (cause) {
        reportAuthFailure(cause);
      }
    },
    [reportAuthFailure],
  );

  const completeProfile = useCallback(
    async (role: AccountRole, nome: string, consent: boolean) => {
      const client = requireClient();
      validateProfileInput(nome, consent, role);
      const current = sessionRef.current;
      if (!current)
        throw new Error("Entre na sua conta para concluir o perfil.");
      const key = `${current.user.id}:${current.access_token}`;
      const { error } = await client.rpc("complete_caa_profile", {
        p_role: role,
        p_nome: nome.trim(),
        p_consent: consent,
        p_expected_user_id: current.user.id,
      });
      if (error)
        throw new Error(
          "Não foi possível concluir o perfil. Verifique sua sessão e tente novamente.",
        );
      const user = await fetchCanonicalUser(client, current);
      if (
        mounted.current &&
        sessionRef.current?.user.id === current.user.id &&
        sessionRef.current.access_token === current.access_token
      )
        setProfile({ key, status: "ready", user, error: null });
    },
    [],
  );

  const signOut = useCallback(async () => {
    const client = requireClient();
    setAuthError(null);
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      clearRecoverySession();
      if (mounted.current) {
        authRevision.current++;
        acceptSession(null);
      }
    } catch (cause) {
      reportAuthFailure(cause);
    }
  }, [acceptSession, reportAuthFailure]);

  const loading =
    restoring ||
    Boolean(
      session && (profile.key !== sessionKey || profile.status === "loading"),
    );
  const user =
    !loading && profile.key === sessionKey && profile.status === "ready"
      ? profile.user
      : null;
  const error =
    authError ?? (profile.key === sessionKey ? profile.error : null);
  const isRecovery = Boolean(
    session && recoveryUntil !== null && recoveryUntil > Date.now(),
  );
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isMock: false,
      session,
      loading,
      error,
      isRecovery,
      signIn,
      signUp,
      signInWithGoogle,
      resetPassword,
      updatePassword,
      completeProfile,
      signOut,
      retrySession,
    }),
    [
      user,
      session,
      loading,
      error,
      isRecovery,
      signIn,
      signUp,
      signInWithGoogle,
      resetPassword,
      updatePassword,
      completeProfile,
      signOut,
      retrySession,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return isMockAuthMode() ? (
    <MockAuthProvider>{children}</MockAuthProvider>
  ) : (
    <RealAuthProvider>{children}</RealAuthProvider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value)
    throw new Error("useAuth deve ser utilizado dentro de AuthProvider.");
  return value;
}
