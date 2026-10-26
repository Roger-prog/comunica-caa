import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  HeartHandshake,
  LoaderCircle,
  MessageCircle,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { configurationError, supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";

export function AuthPage({ onPreview }: { onPreview: () => void }) {
  const { signIn, signUp, error: sessionError, retrySession } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissedSessionError, setDismissedSessionError] = useState(false);
  const registering = mode === "register";

  function changeMode(next: "login" | "register") {
    setMode(next);
    setPassword("");
    setConfirmation("");
    setShowPassword(false);
    setConsent(false);
    setError(null);
    setNotice(null);
    setDismissedSessionError(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !supabase) return;
    setError(null);
    setNotice(null);
    setDismissedSessionError(true);
    if (registering && password !== confirmation) {
      setError("As senhas informadas não coincidem.");
      return;
    }
    setBusy(true);

    try {
      if (registering) {
        const result = await signUp(nome, email, password, consent);
        if (result === "confirmation-required") {
          setNotice(
            "Se o cadastro foi aceito, você receberá um link de confirmação. Verifique seu e-mail e, após confirmar, volte para entrar.",
          );
          setPassword("");
          setConfirmation("");
        }
      } else {
        await signIn(email, password);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir a operação. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  const displayedError =
    error ?? (!dismissedSessionError ? sessionError : null);

  return (
    <main className="min-h-dvh bg-[#faf9f6] text-[#2e2937]">
      <a
        href="#auth-form"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3"
      >
        Ir para o formulário
      </a>
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 py-7 sm:px-10 lg:py-10">
        <header className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-[#6c48a0] text-white">
            <MessageCircle aria-hidden="true" size={25} strokeWidth={2} />
          </span>
          <div>
            <p className="text-2xl font-bold tracking-tight">
              Comunica<span className="text-[#6c48a0]">.</span>
            </p>
            <p className="text-xs font-medium tracking-wide text-[#6b6475]">
              COMUNICAÇÃO QUE APROXIMA
            </p>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
          <section aria-labelledby="welcome-title" className="max-w-lg">
            <p className="eyebrow mb-5 inline-flex items-center gap-2 text-[#6c48a0]">
              <span
                className="size-2 rounded-full bg-[#6c48a0]"
                aria-hidden="true"
              />
              COMUNICAÇÃO AUMENTATIVA E ALTERNATIVA
            </p>
            <h1
              id="welcome-title"
              className="text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl lg:text-6xl"
            >
              Cada expressão
              <br />
              <span className="text-[#6c48a0]">importa.</span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-[#6b6475]">
              Um espaço para se expressar, construir autonomia e acompanhar cada
              nova forma de comunicar.
            </p>
            <div className="mt-9 space-y-4">
              <Feature
                icon={MessageCircle}
                title="Encontre as palavras"
                text="Uma prancha visual simples, organizada por categorias."
              />
              <Feature
                icon={Volume2}
                title="Dê voz às escolhas"
                text="Toque em um símbolo para ouvir sua mensagem."
              />
              <Feature
                icon={HeartHandshake}
                title="Acompanhe cada passo"
                text="Perfis individuais, histórico e registros de comunicação."
              />
            </div>
          </section>

          <section
            id="auth-form"
            aria-labelledby="auth-title"
            className="surface rounded-[1.75rem] border border-[#e7e2eb] bg-white p-6 shadow-[0_10px_50px_-30px_rgba(70,40,100,0.35)] sm:p-9"
          >
            <div
              className="mb-7 flex rounded-xl bg-[#f5f1fa] p-1"
              aria-label="Escolha de acesso"
            >
              <button
                type="button"
                aria-pressed={!registering}
                disabled={busy}
                onClick={() => changeMode("login")}
                className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${!registering ? "bg-white text-[#6c48a0] shadow-sm" : "text-[#6b6475] hover:text-[#6c48a0]"}`}
              >
                Entrar
              </button>
              <button
                type="button"
                aria-pressed={registering}
                disabled={busy}
                onClick={() => changeMode("register")}
                className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${registering ? "bg-white text-[#6c48a0] shadow-sm" : "text-[#6b6475] hover:text-[#6c48a0]"}`}
              >
                Criar conta
              </button>
            </div>

            <h2
              id="auth-title"
              className="text-2xl font-semibold tracking-tight"
            >
              {registering ? "Vamos começar?" : "Que bom ter você aqui."}
            </h2>
            <p className="mb-7 mt-2 text-sm leading-relaxed text-[#6b6475]">
              {registering
                ? "Crie sua conta para organizar seus perfis e registros."
                : "Acesse sua conta e continue de onde parou."}
            </p>

            {configurationError && (
              <div
                role="status"
                className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950"
              >
                {configurationError} A demonstração permanece disponível abaixo,
                sem conexão com o banco.
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="space-y-4"
              aria-busy={busy}
            >
              {registering && (
                <label
                  className="block text-sm font-medium"
                  htmlFor="auth-name"
                >
                  Nome
                  <input
                    id="auth-name"
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={80}
                    value={nome}
                    onChange={(event) => setNome(event.target.value)}
                    disabled={busy}
                    className="input-field mt-2 w-full"
                    placeholder="Como você gostaria de ser chamado?"
                  />
                </label>
              )}
              <label className="block text-sm font-medium" htmlFor="auth-email">
                E-mail
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                  className="input-field mt-2 w-full"
                  placeholder="voce@exemplo.com"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
              <div>
                <label
                  className="block text-sm font-medium"
                  htmlFor="auth-password"
                >
                  Senha
                </label>
                <div className="relative mt-2">
                  <input
                    id="auth-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      registering ? "new-password" : "current-password"
                    }
                    required
                    minLength={registering ? 10 : undefined}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                    className="input-field w-full pr-14"
                    aria-describedby={
                      registering ? "password-requirements" : undefined
                    }
                  />
                  <button
                    type="button"
                    aria-label={
                      showPassword ? "Ocultar senha" : "Mostrar senha"
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                    disabled={busy}
                    className="absolute inset-y-0 right-1 flex min-w-11 items-center justify-center rounded-lg text-[#6b6475] hover:text-[#6c48a0]"
                  >
                    {showPassword ? (
                      <EyeOff size={19} aria-hidden="true" />
                    ) : (
                      <Eye size={19} aria-hidden="true" />
                    )}
                  </button>
                </div>
                {registering && (
                  <p
                    id="password-requirements"
                    className="mt-2 text-xs text-[#6b6475]"
                  >
                    Use pelo menos 10 caracteres.
                  </p>
                )}
              </div>
              {registering && (
                <>
                  <label
                    className="block text-sm font-medium"
                    htmlFor="auth-password-confirmation"
                  >
                    Confirmar senha
                    <input
                      id="auth-password-confirmation"
                      name="password-confirmation"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={10}
                      maxLength={128}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      disabled={busy}
                      className="input-field mt-2 w-full"
                    />
                  </label>
                  <label
                    className="flex cursor-pointer items-start gap-3 rounded-xl bg-[#f8f6fb] p-3 text-xs leading-relaxed text-[#5f576b]"
                    htmlFor="auth-consent"
                  >
                    <input
                      id="auth-consent"
                      name="consent"
                      type="checkbox"
                      required
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                      disabled={busy}
                      className="mt-0.5 size-4 shrink-0 accent-[#6c48a0]"
                    />
                    <span>
                      Estou ciente de que meu nome, e-mail e os perfis e
                      registros que eu cadastrar serão armazenados no Supabase
                      para operar o Comunica. A senha é gerenciada pelo serviço
                      de autenticação.
                    </span>
                  </label>
                </>
              )}
              {displayedError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-900"
                >
                  {displayedError}
                  {!error && sessionError && (
                    <button
                      type="button"
                      onClick={() => void retrySession()}
                      className="mt-2 block font-semibold underline underline-offset-2"
                    >
                      Tentar restaurar a sessão
                    </button>
                  )}
                </div>
              )}
              {notice && (
                <p
                  role="status"
                  className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-relaxed text-emerald-950"
                >
                  <Check
                    size={19}
                    className="mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  {notice}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || !supabase}
                className="button-primary flex min-h-12 w-full items-center justify-center gap-2"
              >
                {busy ? (
                  <LoaderCircle
                    size={18}
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
                {busy
                  ? "Aguarde…"
                  : registering
                    ? "Criar minha conta"
                    : "Entrar na minha conta"}
                {!busy && <ArrowRight size={18} aria-hidden="true" />}
              </button>
            </form>

            <div className="mt-6 border-t border-[#eeeaf2] pt-5 text-center">
              <button
                type="button"
                onClick={onPreview}
                disabled={busy}
                className="button-secondary min-h-11 w-full text-sm"
              >
                Explorar demonstração
              </button>
              <p className="mt-2 text-xs leading-relaxed text-[#6b6475]">
                Conheça a interface sem criar uma conta. Dados fictícios, sem
                gravação no banco.
              </p>
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-center gap-2 text-xs text-[#6b6475]">
          <ShieldCheck size={15} aria-hidden="true" />
          <span>Seu espaço de comunicação, com acesso individual.</span>
        </footer>
      </div>
    </main>
  );
}

function Feature({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof MessageCircle;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eee7f5] text-[#6c48a0]">
        <Icon size={21} aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-[#6b6475]">{text}</p>
      </div>
    </div>
  );
}
