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

type SignUpResult = "signed-in" | "confirmation-required";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    nome: string,
    email: string,
    password: string,
    consent: boolean,
  ) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  retrySession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const authRevision = useRef(0);
  const restoration = useRef(0);

  const retrySession = useCallback(async () => {
    if (!supabase) {
      setError(configurationError);
      setLoading(false);
      return;
    }

    const request = ++restoration.current;
    const currentLifecycle = lifecycle.current;
    const revision = authRevision.current;
    setLoading(true);
    setError(null);

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (
        !mounted.current ||
        lifecycle.current !== currentLifecycle ||
        restoration.current !== request ||
        authRevision.current !== revision
      )
        return;
      if (sessionError) throw sessionError;
      setSession(data.session);
    } catch (cause) {
      if (
        mounted.current &&
        lifecycle.current === currentLifecycle &&
        restoration.current === request &&
        authRevision.current === revision
      )
        setError(authErrorMessage(cause));
    } finally {
      if (
        mounted.current &&
        lifecycle.current === currentLifecycle &&
        restoration.current === request
      )
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const currentLifecycle = ++lifecycle.current;
    if (!supabase) {
      setLoading(false);
      return () => {
        mounted.current = false;
        lifecycle.current++;
      };
    }

    // Keep this callback synchronous: auth methods inside it can contend for
    // the client's auth lock. Data queries belong in consumers' effects.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted.current || lifecycle.current !== currentLifecycle) return;
      authRevision.current++;
      setSession(nextSession);
      setError(null);
      setLoading(false);
    });
    void retrySession();

    return () => {
      mounted.current = false;
      lifecycle.current++;
      restoration.current++;
      subscription.unsubscribe();
    };
  }, [retrySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = requireClient();
    setError(null);
    try {
      const { error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
    } catch (cause) {
      const text = authErrorMessage(cause);
      if (mounted.current) setError(text);
      throw new Error(text);
    }
  }, []);

  const signUp = useCallback(
    async (
      nome: string,
      email: string,
      password: string,
      consent: boolean,
    ): Promise<SignUpResult> => {
      const client = requireClient();
      if (!nome.trim() || nome.trim().length > 80) {
        throw new Error("Informe seu nome, com até 80 caracteres.");
      }
      if (password.length < 10) {
        throw new Error("A senha deve ter pelo menos 10 caracteres.");
      }
      if (!consent) {
        throw new Error(
          "Confirme o aviso de armazenamento de dados para criar sua conta.",
        );
      }
      setError(null);

      try {
        const { data, error: signUpError } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              nome: nome.trim(),
              name: nome.trim(),
              role: "responsavel",
              consent: true,
            },
          },
        });
        if (signUpError) throw signUpError;
        return data.session ? "signed-in" : "confirmation-required";
      } catch (cause) {
        const text = authErrorMessage(cause);
        if (mounted.current) setError(text);
        throw new Error(text);
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    const client = requireClient();
    setError(null);
    try {
      const { error: signOutError } = await client.auth.signOut({
        scope: "local",
      });
      if (signOutError) throw signOutError;
    } catch (cause) {
      const text = authErrorMessage(cause);
      if (mounted.current) setError(text);
      throw new Error(text);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      error,
      signIn,
      signUp,
      signOut,
      retrySession,
    }),
    [session, loading, error, signIn, signUp, signOut, retrySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value)
    throw new Error("useAuth deve ser utilizado dentro de AuthProvider.");
  return value;
}
