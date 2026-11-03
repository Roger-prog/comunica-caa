import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { configurationError, supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import {
  AuthAlert,
  AuthLayout,
  AuthNotice,
  operationError,
  SubmitButton,
} from "./AuthLayout";

export function EsqueciSenha() {
  const { isMock, resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (isMock) return <Navigate to="/login" replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !supabase || !email.trim()) return;
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (cause) {
      setError(operationError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout
      title="Esqueci minha senha"
      description="Informe o e-mail da sua conta para receber um link de recuperação."
    >
      {configurationError && (
        <div className="mb-5">
          <AuthNotice>{configurationError}</AuthNotice>
        </div>
      )}
      <form onSubmit={submit} aria-busy={busy} className="space-y-5">
        <label htmlFor="reset-email" className="block text-sm font-medium">
          E-mail
          <input
            id="reset-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            className="input-field mt-2"
          />
        </label>
        {error && <AuthAlert>{error}</AuthAlert>}
        <SubmitButton busy={busy} disabled={!supabase}>
          Enviar link de recuperação
        </SubmitButton>
      </form>
      {sent && (
        <p role="status" className="mt-4 text-sm text-stone-600">
          Solicitação recebida.
        </p>
      )}
      <Link
        to="/login"
        className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 underline underline-offset-4"
      >
        Voltar ao login
      </Link>
    </AuthLayout>
  );
}
