import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { homeForRole } from "./authRouting";
import { AuthAlert, AuthLayout, AuthNotice } from "./AuthLayout";

export function AuthCallback() {
  const { user, loading, error, isRecovery, retrySession } = useAuth();
  const location = useLocation();
  const [callbackFailed] = useState(() => {
    const search = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    return [search, hash].some(
      (params) => params.has("error") || params.has("error_code"),
    );
  });
  if (!loading && !callbackFailed && !error && isRecovery)
    return <Navigate to="/redefinir-senha" replace />;
  if (!loading && !callbackFailed && !error && user)
    return (
      <Navigate
        to={user.emailConfirmed ? homeForRole(user.role) : "/confirmar-email"}
        replace
      />
    );
  return (
    <AuthLayout
      title="Concluir acesso"
      description="Estamos verificando sua autenticação para abrir o seu espaço."
    >
      {loading ? (
        <AuthNotice>Validando o acesso…</AuthNotice>
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
