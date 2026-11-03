import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import type { AccountRole } from "./authTypes";
import { homeForRole } from "./authRouting";
import {
  AuthAlert,
  AuthLayout,
  AuthNotice,
  ConsentField,
  operationError,
  RoleFields,
  SubmitButton,
} from "./AuthLayout";

export function CompletarPerfil() {
  const { user, loading, completeProfile, signOut } = useAuth();
  const [nome, setNome] = useState(user?.name ?? "");
  const [role, setRole] = useState<AccountRole | "">("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!loading && !user) return <Navigate to="/login" replace />;
  if (user?.role && user.emailConfirmed)
    return <Navigate to={homeForRole(user.role)} replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !user?.emailConfirmed) return;
    setError(null);
    if (!role || !nome.trim() || !consent) {
      setError(
        "Informe seu nome, escolha o tipo de conta e confirme o aviso de armazenamento.",
      );
      return;
    }
    setBusy(true);
    try {
      await completeProfile(role, nome.trim(), consent);
    } catch (cause) {
      setError(operationError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function exit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch (cause) {
      setError(operationError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout
      title="Complete seu perfil"
      description="Confirme seu nome e escolha como você utilizará o Comunica."
    >
      {loading ? (
        <AuthNotice>Carregando seu perfil…</AuthNotice>
      ) : !user?.emailConfirmed ? (
        <p role="status" className="text-sm text-stone-600">
          Confirme seu e-mail antes de concluir o acesso.
        </p>
      ) : (
        <form onSubmit={submit} aria-busy={busy} className="space-y-5">
          <label htmlFor="profile-name" className="block text-sm font-medium">
            Nome
            <input
              id="profile-name"
              autoComplete="name"
              required
              maxLength={80}
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              disabled={busy}
              className="input-field mt-2"
            />
          </label>
          <RoleFields value={role} onChange={setRole} disabled={busy} />
          <ConsentField
            checked={consent}
            onChange={setConsent}
            disabled={busy}
          />
          {error && <AuthAlert>{error}</AuthAlert>}
          <SubmitButton busy={busy}>Concluir cadastro</SubmitButton>
        </form>
      )}
      {error && !user?.emailConfirmed && (
        <div className="mt-4">
          <AuthAlert>{error}</AuthAlert>
        </div>
      )}
      <button
        type="button"
        disabled={busy || loading}
        onClick={() => void exit()}
        className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 underline underline-offset-4"
      >
        Sair da conta
      </button>
    </AuthLayout>
  );
}
