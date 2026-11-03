import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { configurationError, supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import {
  AuthAlert,
  AuthLayout,
  AuthNotice,
  GoogleButton,
  operationError,
  SubmitButton,
} from "./AuthLayout";

export function Login() {
  const {
    signIn,
    signInWithGoogle,
    error: sessionError,
    retrySession,
    isMock,
  } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const unavailable = !isMock && !supabase;
  const displayedError = error ?? (!submitted ? sessionError : null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || unavailable) return;
    setSubmitted(true);
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(operationError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    if (busy || unavailable || isMock) return;
    setSubmitted(true);
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (cause) {
      setError(operationError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout
      title="Que bom ter você aqui."
      description={
        isMock
          ? "Para apresentar o Comunica, basta clicar em Entrar. Os campos abaixo são opcionais."
          : "Acesse sua conta para continuar. Confirme seu e-mail pelo link recebido antes do primeiro acesso."
      }
    >
      {isMock && (
        <p className="mb-5 text-sm font-semibold text-brand-600">
          Acesso de demonstração
        </p>
      )}
      {!isMock && configurationError && (
        <div className="mb-5">
          <AuthNotice>{configurationError}</AuthNotice>
        </div>
      )}
      {(location.state as { passwordUpdated?: unknown } | null)
        ?.passwordUpdated === true && (
        <div className="mb-5">
          <AuthNotice>Senha atualizada. Entre com sua nova senha.</AuthNotice>
        </div>
      )}
      <form
        onSubmit={submit}
        noValidate={isMock}
        aria-busy={busy}
        className="space-y-4"
      >
        <label className="block text-sm font-medium" htmlFor="auth-email">
          E-mail
          <input
            id="auth-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete={isMock ? "off" : "email"}
            required={!isMock}
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            className="input-field mt-2"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={isMock ? "demo@comunica.com" : "voce@exemplo.com"}
          />
        </label>
        <div>
          <label className="block text-sm font-medium" htmlFor="auth-password">
            Senha
          </label>
          <div className="relative mt-2">
            <input
              id="auth-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isMock ? "off" : "current-password"}
              required={!isMock}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              className="input-field pr-14"
              placeholder={isMock ? "Opcional na demonstração" : undefined}
            />
            <button
              type="button"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((current) => !current)}
              disabled={busy}
              className="absolute inset-y-0 right-1 flex min-w-11 items-center justify-center rounded-xl text-stone-500"
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" size={19} />
              ) : (
                <Eye aria-hidden="true" size={19} />
              )}
            </button>
          </div>
        </div>
        {!isMock && (
          <div className="text-right">
            <Link
              to="/esqueci-senha"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 underline underline-offset-4"
            >
              Esqueci minha senha
            </Link>
          </div>
        )}
        {displayedError && (
          <AuthAlert>
            {displayedError}
            {!error && sessionError && (
              <button
                type="button"
                onClick={() => void retrySession().catch(() => {})}
                className="mt-2 block min-h-10 font-semibold underline"
              >
                Tentar restaurar a sessão
              </button>
            )}
          </AuthAlert>
        )}
        <SubmitButton
          busy={busy}
          disabled={unavailable}
          busyLabel={isMock ? "Entrando…" : "Aguarde…"}
        >
          {isMock ? "Entrar" : "Entrar na minha conta"}
        </SubmitButton>
      </form>
      {!isMock && (
        <div className="mt-5 space-y-4">
          <GoogleButton
            busy={busy}
            disabled={unavailable}
            onClick={() => void google()}
          />
          <p className="text-center text-sm text-stone-500">
            Ainda não tem uma conta?{" "}
            <Link
              to="/cadastro"
              className="inline-flex min-h-11 items-center font-semibold text-brand-600 underline underline-offset-4"
            >
              Criar conta
            </Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
