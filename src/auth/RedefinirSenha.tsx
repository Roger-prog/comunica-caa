import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import {
  AuthAlert,
  AuthLayout,
  AuthNotice,
  operationError,
  SubmitButton,
} from "./AuthLayout";

export function RedefinirSenha() {
  const { session, loading, isMock, isRecovery, updatePassword, signOut } =
    useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !isRecovery || !session?.user.id || isMock) return;
    setError(null);
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
      await updatePassword(password);
      setPassword("");
      setConfirmation("");
      setUpdated(true);
    } catch (cause) {
      setError(
        operationError(
          cause,
          "Não foi possível atualizar a senha. Solicite um novo link e tente novamente.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signOut();
      navigate("/login", { replace: true, state: { passwordUpdated: true } });
    } catch {
      setError(
        "Sua senha foi atualizada, mas não foi possível encerrar a sessão. Tente sair novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout
      title="Redefinir senha"
      description="Escolha uma nova senha para sua conta do Comunica."
    >
      {loading ? (
        <AuthNotice>Validando o link de recuperação…</AuthNotice>
      ) : updated ? (
        <div className="space-y-5">
          <AuthNotice>
            Senha atualizada. Use a nova senha no próximo acesso.
          </AuthNotice>
          {error && <AuthAlert>{error}</AuthAlert>}
          <button
            type="button"
            onClick={() => void finish()}
            disabled={busy}
            className="button-primary w-full"
          >
            {busy ? "Saindo…" : "Sair e entrar novamente"}
          </button>
        </div>
      ) : !isRecovery || !session?.user.id || isMock ? (
        <div className="space-y-4">
          <AuthAlert>
            O link de recuperação é inválido ou expirou. Solicite um novo link
            para continuar.
          </AuthAlert>
          <Link to="/esqueci-senha" className="button-primary w-full">
            Solicitar novo link
          </Link>
          <Link
            to="/login"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 underline underline-offset-4"
          >
            Voltar ao login
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} aria-busy={busy} className="space-y-5">
          <label htmlFor="new-password" className="block text-sm font-medium">
            Nova senha
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              aria-describedby="new-password-requirements"
              className="input-field mt-2"
            />
          </label>
          <p id="new-password-requirements" className="text-xs text-stone-500">
            Use pelo menos 10 caracteres.
          </p>
          <label
            htmlFor="new-password-confirmation"
            className="block text-sm font-medium"
          >
            Confirmar nova senha
            <input
              id="new-password-confirmation"
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
          {error && <AuthAlert>{error}</AuthAlert>}
          <SubmitButton busy={busy}>Salvar nova senha</SubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
