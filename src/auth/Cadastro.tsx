import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { configurationError, supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import type { AccountRole } from "./authTypes";
import {
  lookupEmailDomain,
  SignupEmailError,
  type EmailDomainStatus,
} from "./signupEmail";
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

const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const VALIDATED_INPUT = "input-field mt-2 aria-invalid:border-red-600";
type ValidatedField = "email" | "password" | "confirmation";

export function Cadastro() {
  const { isMock, signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [role, setRole] = useState<AccountRole | "">("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailServerError, setEmailServerError] = useState<string | null>(null);
  const [invalidDomain, setInvalidDomain] = useState<string | null>(null);
  const domainRequest = useRef<{
    domain: string;
    result: Promise<EmailDomainStatus>;
  } | null>(null);
  const [checkedFields, setCheckedFields] = useState<
    Partial<Record<ValidatedField, boolean>>
  >({});
  const normalizedEmail = email.trim();
  const emailFormatError = !normalizedEmail
    ? "Informe seu e-mail."
    : normalizedEmail.length > 254 || !EMAIL_PATTERN.test(normalizedEmail)
      ? "Informe um e-mail válido, como voce@exemplo.com."
      : null;
  const domain = emailFormatError
    ? null
    : normalizedEmail.slice(normalizedEmail.lastIndexOf("@") + 1).toLowerCase();
  const emailError = emailFormatError ?? (
    invalidDomain && invalidDomain === domain
      ? "E-mail inválido. Esse domínio não existe ou não recebe e-mails."
      : emailServerError
  );
  const passwordError =
    password.length < MIN_PASSWORD_LENGTH
      ? `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
      : password.length > MAX_PASSWORD_LENGTH
        ? `A senha deve ter até ${MAX_PASSWORD_LENGTH} caracteres.`
        : null;
  const confirmationError = !confirmation
    ? "Confirme sua senha."
    : confirmation !== password
      ? "As senhas informadas não coincidem."
      : null;
  const showEmailError = checkedFields.email && !!emailError;
  const showPasswordError = checkedFields.password && !!passwordError;
  const showConfirmationError =
    checkedFields.confirmation && !!confirmationError;
  if (isMock) return <Navigate to="/login" replace />;

  function checkField(field: ValidatedField) {
    setCheckedFields((previous) => ({ ...previous, [field]: true }));
  }

  function checkDomain(domain: string) {
    if (domainRequest.current?.domain === domain) return domainRequest.current.result;
    const result = lookupEmailDomain(domain).then((status) => {
      if (domainRequest.current?.result === result) {
        setInvalidDomain(status === "invalid" ? domain : null);
        if (status === "unknown") domainRequest.current = null;
      }
      return status;
    });
    domainRequest.current = { domain, result };
    return result;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !supabase) return;
    setError(null);
    setEmailServerError(null);
    setCheckedFields({ email: true, password: true, confirmation: true });
    if (!role) {
      setError("Escolha o tipo de conta: Responsável ou Fonoaudiólogo.");
      return;
    }
    if (!nome.trim() || !consent) {
      setError("Preencha seus dados e confirme o aviso de armazenamento.");
      return;
    }
    if (!domain || passwordError || confirmationError) return;
    setBusy(true);
    try {
      if (await checkDomain(domain) === "invalid") return;
      const outcome = await signUp(
        nome.trim(), normalizedEmail, password, consent, role,
      );
      setPassword("");
      setConfirmation("");
      setCheckedFields({});
      if (outcome === "confirmation-required")
        navigate("/confirmar-email", { replace: true });
    } catch (cause) {
      if (cause instanceof SignupEmailError) setEmailServerError(cause.message);
      else setError(operationError(cause));
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
      <form onSubmit={submit} noValidate aria-busy={busy} className="space-y-5">
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
        <div>
          <label htmlFor="register-email" className="block text-sm font-medium">
            E-mail
          </label>
          <input
            id="register-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailServerError(null);
            }}
            onBlur={() => {
              checkField("email");
              if (domain) void checkDomain(domain);
            }}
            disabled={busy}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={showEmailError || undefined}
            aria-describedby={showEmailError ? "register-email-error" : undefined}
            className={VALIDATED_INPUT}
          />
          <p
            id="register-email-error"
            aria-live="polite"
            className="text-sm text-red-700 not-empty:mt-1.5"
          >
            {showEmailError && emailError}
          </p>
        </div>
        <div>
          <label
            htmlFor="register-password"
            className="block text-sm font-medium"
          >
            Senha
          </label>
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => checkField("password")}
            disabled={busy}
            aria-invalid={showPasswordError || undefined}
            aria-describedby="register-password-requirements"
            className={VALIDATED_INPUT}
          />
          <p
            id="register-password-requirements"
            aria-live="polite"
            className={
              showPasswordError
                ? "mt-1.5 text-sm text-red-700"
                : "mt-1.5 text-xs text-stone-500"
            }
          >
            {showPasswordError
              ? passwordError
              : `Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`}
          </p>
        </div>
        <div>
          <label
            htmlFor="register-confirmation"
            className="block text-sm font-medium"
          >
            Confirmar senha
          </label>
          <input
            id="register-confirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            onBlur={() => checkField("confirmation")}
            disabled={busy}
            aria-invalid={showConfirmationError || undefined}
            aria-describedby={showConfirmationError ? "register-confirmation-error" : undefined}
            className={VALIDATED_INPUT}
          />
          <p
            id="register-confirmation-error"
            aria-live="polite"
            className="text-sm text-red-700 not-empty:mt-1.5"
          >
            {showConfirmationError && confirmationError}
          </p>
        </div>
        <ConsentField checked={consent} onChange={setConsent} disabled={busy} />
        {error && <AuthAlert>{error}</AuthAlert>}
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
