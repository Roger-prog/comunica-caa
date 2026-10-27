import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, LockKeyhole } from "lucide-react";

interface ChildModePinDialogProps {
  open: boolean;
  mode: "setup" | "unlock";
  onSubmit: (pin: string) => Promise<boolean>;
  onCancel: () => void;
  busy?: boolean;
}

/** The caller owns the locked state; dismissing this dialog never unlocks it. */
export function ChildModePinDialog({
  open,
  mode,
  onSubmit,
  onCancel,
  busy = false,
}: ChildModePinDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const revision = useRef(0);
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fallback, setFallback] = useState(false);
  const id = useId();
  const setup = mode === "setup";
  const waiting = busy || submitting;

  useEffect(() => {
    revision.current += 1;
    pending.current = false;
    setSubmitting(false);
    setPin("");
    setConfirmation("");
    setError(null);
    setFallback(false);
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    try {
      if (typeof dialog.showModal !== "function")
        throw new Error("dialog_unsupported");
      if (!dialog.open) dialog.showModal();
    } catch {
      // Keeps the same controlled workflow on browsers without native dialog.
      dialog.setAttribute("open", "");
      setFallback(true);
    }
    pinRef.current?.focus();

    return () => {
      revision.current += 1;
      pending.current = false;
      if (typeof dialog.close === "function") {
        try {
          dialog.close();
        } catch {
          dialog.removeAttribute("open");
        }
      } else dialog.removeAttribute("open");
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open, mode]);

  useEffect(() => {
    if (open && !waiting && error) pinRef.current?.focus();
  }, [open, waiting, error]);

  function cancel() {
    if (waiting || pending.current) return;
    setPin("");
    setConfirmation("");
    setError(null);
    onCancel();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:not(:disabled), button:not(:disabled), [tabindex="0"]',
    );
    if (!focusable?.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (waiting || pending.current) return;
    if (!/^[0-9]{4,6}$/.test(pin)) {
      setError("Informe um PIN com 4 a 6 números.");
      pinRef.current?.focus();
      return;
    }
    if (setup && pin !== confirmation) {
      setError("Os PINs não coincidem. Confira a confirmação.");
      return;
    }
    const current = revision.current;
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const accepted = await onSubmit(pin);
      if (current !== revision.current) return;
      if (!accepted) {
        setError(
          setup
            ? "Não foi possível salvar o PIN. Tente novamente."
            : "PIN incorreto. Tente novamente.",
        );
        setPin("");
        if (setup) setConfirmation("");
      }
    } catch {
      if (current === revision.current) {
        setError("Não foi possível verificar o PIN. Tente novamente.");
        setPin("");
      }
    } finally {
      if (current === revision.current) {
        pending.current = false;
        setSubmitting(false);
        pinRef.current?.focus();
      }
    }
  }

  if (!open) return null;

  return createPortal(
    <>
      {fallback && (
        <div aria-hidden="true" className="fixed inset-0 z-50 bg-black/40" />
      )}
      <dialog
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onCancel={(event) => {
          event.preventDefault();
          cancel();
        }}
        onKeyDown={handleKeyDown}
        className="fixed inset-0 z-[60] m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-3xl border border-stone-200 bg-white p-6 text-ink shadow-xl backdrop:bg-black/40 sm:p-8"
      >
        <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <LockKeyhole size={24} aria-hidden="true" />
        </span>
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
          {setup ? "PIN do modo criança (T21)" : "Sair do modo criança"}
        </h2>
        <p
          id={`${id}-description`}
          className="mt-3 text-sm leading-6 text-stone-600"
        >
          {setup
            ? "Defina um PIN de 4 a 6 números para o responsável sair da prancha. Guarde esse número."
            : "Digite o PIN do responsável para restaurar a navegação."}
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => void submit(event)}
          noValidate
          aria-busy={waiting}
        >
          <div>
            <label
              htmlFor={`${id}-pin`}
              className="mb-2 block text-sm font-medium"
            >
              {setup ? "Novo PIN" : "PIN do responsável"}
            </label>
            <input
              ref={pinRef}
              id={`${id}-pin`}
              name="child-mode-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{4,6}"
              minLength={4}
              maxLength={6}
              required
              disabled={waiting}
              value={pin}
              onChange={(event) => {
                setPin(event.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              className="input-field min-h-12 text-center text-xl tracking-[0.5em]"
            />
          </div>
          {setup && (
            <div>
              <label
                htmlFor={`${id}-confirmation`}
                className="mb-2 block text-sm font-medium"
              >
                Confirmar PIN
              </label>
              <input
                id={`${id}-confirmation`}
                name="child-mode-pin-confirmation"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{4,6}"
                minLength={4}
                maxLength={6}
                required
                disabled={waiting}
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setError(null);
                }}
                className="input-field min-h-12 text-center text-xl tracking-[0.5em]"
              />
            </div>
          )}
          {error && (
            <p
              id={`${id}-error`}
              role="alert"
              className="rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-800"
            >
              {error}
            </p>
          )}
          <div className="flex flex-col gap-3 pt-2 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={waiting}
              className="button-primary min-h-12 flex-1"
            >
              {waiting && (
                <LoaderCircle
                  size={18}
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              )}
              {waiting
                ? "Aguarde…"
                : setup
                  ? "Salvar PIN e iniciar"
                  : "Desbloquear"}
            </button>
            <button
              type="button"
              disabled={waiting}
              onClick={cancel}
              className="button-secondary min-h-12"
            >
              Cancelar
            </button>
          </div>
        </form>
      </dialog>
    </>,
    document.body,
  );
}
