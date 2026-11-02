import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { homeForRole } from "./authRouting";

export function EmailConfirmation() {
  const { user, loading, signOut, retrySession } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (user?.emailConfirmed)
    return <Navigate to={homeForRole(user.role)} replace />;

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError("Não foi possível concluir a operação. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-5 py-10">
      <section
        className="surface w-full max-w-lg p-7 sm:p-10"
        aria-labelledby="confirmation-title"
      >
        <MailCheck
          className="mb-5 text-brand-600"
          aria-hidden="true"
          size={32}
        />
        <h1 id="confirmation-title" className="text-2xl font-semibold">
          Confirme seu e-mail
        </h1>
        <p role="status" className="mt-4 leading-7 text-stone-600">
          Verifique sua caixa de entrada e a pasta de spam. Abra o link enviado
          pelo Comunica para confirmar seu endereço antes de acessar o painel.
          Abra o link no mesmo navegador em que iniciou o cadastro.
        </p>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {user ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="button-primary"
              disabled={busy || loading}
              onClick={() => void run(retrySession)}
            >
              Já confirmei meu e-mail
            </button>
            <button
              className="button-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await signOut();
                  navigate("/login", { replace: true });
                })
              }
            >
              Sair da conta
            </button>
          </div>
        ) : (
          <Link to="/login" className="button-primary mt-6 inline-flex">
            Voltar para o login
          </Link>
        )}
      </section>
    </main>
  );
}
