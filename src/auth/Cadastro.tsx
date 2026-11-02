import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { configurationError, supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import type { AccountRole } from "./authTypes";
import {
  AuthAlert,
  AuthLayout,
  AuthNotice,
  ConsentField,
  GoogleButton,
  operationError,
  RoleFields,
  SubmitButton,
} from "./AuthLayout";

export function Cadastro() {
  const { isMock, signUp, signInWithGoogle } = useAuth();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [role, setRole] = useState<AccountRole | "">("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  if (isMock) return <Navigate to="/login" replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !supabase) return;
    setError(null);
    setNotice(false);
    if (!role) {
      setError("Escolha o tipo de conta: Responsável ou Fonoaudiólogo.");
      return;
    }
    if (!nome.trim() || !email.trim() || !consent) {
      setError("Preencha seus dados e confirme o aviso de armazenamento.");
      return;
    }
    if (password.length < 10) {
      setError("A senha deve ter pelo menos 10 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas informadas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      await signUp(nome.trim(), email.trim(), password, consent, role);
      setPassword("");
      setConfirmation("");
      setNotice(true);
    } catch (cause) {
      setError(operationError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    if (busy || !supabase) return;
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
      title="Crie sua conta"
      description="Escolha seu tipo de conta para acessar os recursos adequados ao seu acompanhamento."
    >
      {configurationError && (
        <div className="mb-5">
          <AuthNotice>{configurationError}</AuthNotice>
        </div>
      )}
      <form onSubmit={submit} aria-busy={busy} className="space-y-5">
        <RoleFields value={role} onChange={setRole} disabled={busy} />
        <label htmlFor="register-name" className="block text-sm font-medium">
          Nome
          <input
            id="register-name"
            autoComplete="name"
            required
            maxLength={80}
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            disabled={busy}
            className="input-field mt-2"
          />
        </label>
        <label htmlFor="register-email" className="block text-sm font-medium">
          E-mail
          <input
            id="register-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            autoCapitalize="none"
            spellCheck={false}
            className="input-field mt-2"
          />
        </label>
        <label
          htmlFor="register-password"
          className="block text-sm font-medium"
        >
          Senha
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            aria-describedby="register-password-requirements"
            className="input-field mt-2"
          />
        </label>
        <p
          id="register-password-requirements"
          className="text-xs text-stone-500"
        >
          Use pelo menos 10 caracteres.
        </p>
        <label
          htmlFor="register-confirmation"
          className="block text-sm font-medium"
        >
          Confirmar senha
          <input
            id="register-confirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
            className="input-field mt-2"
          />
        </label>
        <ConsentField checked={consent} onChange={setConsent} disabled={busy} />
        {error && <AuthAlert>{error}</AuthAlert>}
        {notice && (
          <AuthNotice>
            Se o cadastro foi aceito, você receberá um link de confirmação.
            Verifique a caixa de entrada e a pasta de spam para confirmar seu
            e-mail antes de acessar o painel. Abra o link neste navegador.
          </AuthNotice>
        )}
        <SubmitButton busy={busy} disabled={!supabase}>
          Criar minha conta
        </SubmitButton>
      </form>
      <div className="mt-5 space-y-3">
        <GoogleButton
          busy={busy}
          disabled={!supabase}
          onClick={() => void google()}
        />
        <p className="text-xs leading-relaxed text-stone-500">
          No primeiro acesso com Google, você confirma o tipo de conta e seus
          dados.
        </p>
        <p className="text-center text-sm text-stone-500">
          Já tem uma conta?{" "}
          <Link
            to="/login"
            className="inline-flex min-h-11 items-center font-semibold text-brand-600 underline underline-offset-4"
          >
            Entrar
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
