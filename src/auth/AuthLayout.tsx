import type { ReactNode } from "react";
import {
  HeartHandshake,
  LoaderCircle,
  MessageCircle,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { AccountRole } from "./authTypes";

export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-[#faf9f6] text-ink">
      <a
        href="#auth-form"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3"
      >
        Ir para o formulário
      </a>
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 py-7 sm:px-10 lg:py-10">
        <header>
          <Link
            to="/login"
            className="inline-flex items-center gap-3 rounded-xl"
            aria-label="Comunica, tela de acesso"
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-600 text-white">
              <MessageCircle aria-hidden="true" size={25} />
            </span>
            <span>
              <span className="block text-2xl font-bold tracking-tight">
                Comunica<span className="text-brand-600">.</span>
              </span>
              <span className="block text-xs font-medium tracking-wide text-stone-500">
                COMUNICAÇÃO QUE APROXIMA
              </span>
            </span>
          </Link>
        </header>
        <div className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
          <section aria-labelledby="welcome-title" className="max-w-lg">
            <p className="eyebrow mb-5">
              Comunicação Aumentativa e Alternativa
            </p>
            <h1
              id="welcome-title"
              className="text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl lg:text-6xl"
            >
              Cada expressão
              <br />
              <span className="text-brand-600">importa.</span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-stone-500">
              Um espaço para se expressar, construir autonomia e acompanhar cada
              nova forma de comunicar.
            </p>
            <div className="mt-9 space-y-4">
              <Feature
                Icon={MessageCircle}
                title="Encontre as palavras"
                text="Uma prancha visual simples, organizada por categorias."
              />
              <Feature
                Icon={Volume2}
                title="Dê voz às escolhas"
                text="Toque em um símbolo para ouvir sua mensagem."
              />
              <Feature
                Icon={HeartHandshake}
                title="Acompanhe cada passo"
                text="Perfis individuais, histórico e registros de comunicação."
              />
            </div>
          </section>
          <section
            id="auth-form"
            aria-labelledby="auth-title"
            className="surface min-w-0 rounded-[1.75rem] p-6 shadow-[0_10px_50px_-30px_rgba(70,40,100,0.35)] sm:p-9"
          >
            <h2
              id="auth-title"
              className="text-2xl font-semibold tracking-tight"
            >
              {title}
            </h2>
            <p className="mb-7 mt-3 text-sm leading-relaxed text-stone-500">
              {description}
            </p>
            {children}
          </section>
        </div>
        <footer className="flex items-center justify-center gap-2 text-xs text-stone-500">
          <ShieldCheck size={15} aria-hidden="true" />
          <span>Seu espaço de comunicação, com acesso individual.</span>
        </footer>
      </div>
    </main>
  );
}
function Feature({
  Icon,
  title,
  text,
}: {
  Icon: typeof MessageCircle;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
        <Icon size={21} aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-stone-500">{text}</p>
      </div>
    </div>
  );
}
export function AuthAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-900"
    >
      {children}
    </div>
  );
}
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm leading-relaxed text-brand-700"
    >
      {children}
    </div>
  );
}
export function SubmitButton({
  busy,
  disabled,
  children,
  busyLabel = "Aguarde…",
}: {
  busy: boolean;
  disabled?: boolean;
  children: ReactNode;
  busyLabel?: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="button-primary w-full"
    >
      {busy && (
        <LoaderCircle
          aria-hidden="true"
          size={18}
          className="animate-spin motion-reduce:animate-none"
        />
      )}
      {busy ? busyLabel : children}
    </button>
  );
}
export function GoogleButton({
  busy,
  disabled,
  onClick,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="button-secondary w-full"
    >
      <span
        aria-hidden="true"
        className="flex size-6 items-center justify-center rounded-full border border-stone-200 bg-white font-bold text-brand-600"
      >
        G
      </span>
      Entrar com Google
    </button>
  );
}
export function RoleFields({
  value,
  onChange,
  disabled,
}: {
  value: AccountRole | "";
  onChange: (role: AccountRole) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="mb-2 text-sm font-semibold">Tipo de conta</legend>
      {(
        [
          [
            "responsavel",
            "Responsável",
            "Organiza os perfis e utiliza a prancha com a criança.",
          ],
          [
            "fonoaudiologo",
            "Fonoaudiólogo",
            "Acompanha pacientes vinculados por convite e gera relatórios.",
          ],
        ] as const
      ).map(([role, label, description]) => (
        <label
          key={role}
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${value === role ? "border-brand-600 bg-brand-50" : "border-stone-200 bg-white"}`}
        >
          <input
            type="radio"
            name="account-role"
            value={role}
            checked={value === role}
            onChange={() => onChange(role)}
            required
            className="mt-1 size-4 shrink-0 accent-brand-600"
          />
          <span>
            <span className="block text-sm font-semibold">{label}</span>
            <span className="mt-1 block text-xs leading-relaxed text-stone-500">
              {description}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
export function ConsentField({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-brand-50 p-3 text-xs leading-relaxed text-stone-600">
      <input
        type="checkbox"
        name="consent"
        required
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-0.5 size-4 shrink-0 accent-brand-600"
      />
      <span>
        Estou ciente do armazenamento dos dados da minha conta e dos registros
        que eu cadastrar para operar o Comunica.
      </span>
    </label>
  );
}
export function operationError(
  cause: unknown,
  fallback = "Não foi possível concluir a operação. Tente novamente.",
) {
  return cause instanceof Error ? cause.message : fallback;
}
