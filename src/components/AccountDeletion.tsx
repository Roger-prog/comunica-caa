import { useId, useState, type FormEvent } from "react";
import type { AuthUser } from "../auth/authTypes";
import type { AccountDeletionPreview } from "../lib/database.types";
import { supabase } from "../lib/supabase";

export function AccountDeletion({ user, signOut }: { user: AuthUser; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const titleId = useId();

  async function readPreview() {
    setPreview(null);
    setConfirmation("");
    const result = await supabase?.rpc("preview_caa_account_deletion", { p_expected_user_id: user.id }).single();
    if (!result || result.error) {
      setMessage("Não foi possível consultar os dados da conta. Tente novamente.");
      return;
    }
    setPreview(result.data);
  }

  async function start() {
    setOpen(true);
    setBusy(true);
    setMessage("");
    try {
      await readPreview();
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !preview || preview.reauth_required || confirmation !== "EXCLUIR" || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await supabase.rpc("confirm_caa_account_deletion", {
        p_expected_user_id: user.id,
        p_confirmation: confirmation,
        p_expected_plan: preview.patients,
        p_expected_review_reason: preview.review_reason,
      });
      if (error) {
        setMessage("Não foi possível concluir a operação. Confira os vínculos e tente novamente.");
      } else if (data === "deleted") {
        await signOut();
      } else if (data === "plan_changed") {
        await readPreview();
        setMessage("Os vínculos ou arquivos da conta mudaram. Confira os detalhes atualizados.");
      } else if (data === "reauth_required") {
        setPreview({ ...preview, reauth_required: true });
      } else if (data === "review_requested") {
        await readPreview();
        setMessage("Solicitação registrada. A conta continua ativa durante a análise.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={titleId} className="mt-4 space-y-3 border-t border-stone-200 pt-4">
      <h3 id={titleId} className="font-bold">Gerenciamento de conta</h3>
      {!open && <button className="button-secondary" type="button" onClick={() => void start()}>Excluir minha conta</button>}
      {open && <div className="space-y-3">
        <p>A exclusão encerra o login e remove os dados e preferências da sua conta e os vínculos em seu nome. É definitiva.</p>
        {preview && <>
          {preview.patients.length > 0 && <ul className="list-disc space-y-1 pl-5">
            {preview.patients.map(patient => <li key={patient.patient_id}>
              <strong>{patient.patient_name}</strong> — {patient.successor_name
                ? `Responsável que assumirá o perfil: ${patient.successor_name}`
                : "Sem outro responsável habilitado para assumir o perfil."}
            </li>)}
          </ul>}
          <p>Histórico, símbolos, fotos, gravações e observações pertencem ao perfil da criança. Quando o perfil é transferido, esses dados continuam disponíveis para as pessoas autorizadas.</p>
          {preview.review_reason === "patient_care" && <p>Para continuar, vincule outro responsável e conceda permissão para gerenciar vínculos, ou solicite análise à equipe de privacidade para tratar os dados da criança.</p>}
          {preview.review_reason === "storage" && <p>Há arquivos do armazenamento privado associados à sua conta. A equipe de privacidade deve verificar a transferência ou a eliminação desses arquivos antes de concluir a exclusão.</p>}
          {preview.review_reason && preview.review_requested_at && <p>Solicitação de exclusão em análise.</p>}
          {preview.reauth_required && <div className="space-y-2">
            <p>Para confirmar sua identidade, saia, entre novamente e retorne a esta seção.</p>
            <button className="button-secondary" type="button" onClick={() => void signOut()}>Sair para entrar novamente</button>
          </div>}
          {!preview.reauth_required && (!preview.review_reason || !preview.review_requested_at) && (
            <form className="space-y-3" onSubmit={event => void confirm(event)}>
              <label className="grid gap-2">Digite EXCLUIR para confirmar
                <input autoComplete="off" className="input-field" value={confirmation} disabled={busy}
                  onChange={event => setConfirmation(event.target.value)} />
              </label>
              <button className="button-secondary text-red-800 dark:text-red-300" type="submit" disabled={busy || confirmation !== "EXCLUIR"}>
                {preview.review_reason ? "Solicitar análise de exclusão" : "Excluir definitivamente"}
              </button>
            </form>
          )}
        </>}
        <button className="button-secondary" type="button" disabled={busy} onClick={() => { setOpen(false); setMessage(""); }}>
          {preview?.review_requested_at ? "Fechar" : "Cancelar"}
        </button>
        {busy && <p role="status">Processando…</p>}
        {message && <p role="status">{message}</p>}
      </div>}
    </section>
  );
}
