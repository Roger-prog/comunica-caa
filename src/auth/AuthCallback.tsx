import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { homeForRole } from "./authRouting";
import { AuthAlert, AuthLayout, AuthNotice } from "./AuthLayout";

export function AuthCallback() {
  const { user, loading, error, isRecovery, retrySession, signOut } = useAuth();
  const location = useLocation();
  const [callbackFailed] = useState(() => {
    const search = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    return [search, hash].some(
      (params) => params.has("error") || params.has("error_code"),
    );
  });
  const [busy, setBusy] = useState(false);
  const [exitError, setExitError] = useState(false);
  if (!loading && !callbackFailed && !error && isRecovery)
    return <Navigate to="/redefinir-senha" replace />;
  if (!loading && !callbackFailed && !error && user?.emailConfirmed)
    return <Navigate to={homeForRole(user.role)} replace />;
  async function exit() {
    setBusy(true);
    setExitError(false);
    try {
      await signOut();
    } catch {
      setExitError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout
      title="Concluir acesso"
      description="Estamos verificando sua autenticação para abrir o seu espaço."
    >
      {loading ? (
        <AuthNotice>Validando o acesso…</AuthNotice>
      ) : user && !user.emailConfirmed && !callbackFailed && !error ? (
        <div className="space-y-4">
          <AuthNotice>
            Confirme seu e-mail pelo link enviado à sua caixa de entrada.
            Verifique também a pasta de spam antes de tentar entrar.
          </AuthNotice>
          {exitError && (
            <AuthAlert>
              Não foi possível encerrar a sessão. Tente novamente.
            </AuthAlert>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void exit()}
            className="button-secondary w-full"
          >
            Sair da conta
          </button>
          <Link
            to="/login"
            className="inline-flex min-h-11 items-center font-semibold text-brand-600 underline"
          >
            Voltar ao login
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <AuthAlert>
            Não foi possível concluir o acesso. O link pode ter expirado ou o
            acesso pode ter sido cancelado. Tente entrar novamente.
          </AuthAlert>
          {!callbackFailed && error && (
            <button
              type="button"
              onClick={() => void retrySession().catch(() => {})}
              className="button-secondary w-full"
            >
              Tentar novamente
            </button>
          )}
          <Link to="/login" className="button-primary w-full">
            Voltar ao login
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
