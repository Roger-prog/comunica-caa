import { useCallback, useEffect, useState } from "react";
import type { AccountRole, AuthUser } from "../auth/authTypes";
import { emptyProfession, ProfessionalFields } from "../auth/ProfessionalFields";
import type { AccountOptionsRow } from "../lib/database.types";
import { supabase } from "../lib/supabase";
import { AccountDeletion } from "./AccountDeletion";

const roleNames = { responsavel: "Responsável", fonoaudiologo: "Fonoaudiólogo / Profissional" };

export function AccountOptions({ user, signOut, onRoleChanged }: {
  user: AuthUser;
  signOut: () => Promise<void>;
  onRoleChanged: () => Promise<void>;
}) {
  const [options, setOptions] = useState<AccountOptionsRow | null>(null);
  const [profession, setProfession] = useState(emptyProfession);
  const [requesting, setRequesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!supabase) return;
    let query = supabase.rpc("get_caa_account_options");
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query.single();
    if (signal?.aborted) return;
    if (error || !data) throw error ?? new Error("account_options");
    setOptions(data);
    setProfession({ category: data.professional_category ?? "", registration: data.professional_registration ?? "" });
  }, [user.id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setNotice("As opções de perfil estão temporariamente indisponíveis.");
    });
    return () => controller.abort();
  }, [load]);

  async function switchRole(role: AccountRole) {
    if (!supabase || busy || !options?.roles.includes(role) || role === user.role) return;
    setBusy(true);
    setNotice("");
    try {
      const { error } = await supabase.rpc("switch_caa_account_role", { p_expected_user_id: user.id, p_role: role });
      if (error) throw error;
      await onRoleChanged();
    } catch {
      setNotice("Não foi possível trocar o perfil. Tente novamente.");
    } finally { setBusy(false); }
  }

  async function requestRole(role: AccountRole) {
    if (!supabase || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const { error } = await supabase.rpc("request_caa_account_role", {
        p_expected_user_id: user.id, p_role: role,
        p_category: role === "fonoaudiologo" ? profession.category : null,
        p_registration: role === "fonoaudiologo" ? profession.registration.trim() || null : null,
      });
      if (error) throw error;
      await load();
      setRequesting(false);
      setNotice(role === "fonoaudiologo" ? "Solicitação enviada para validação." : "Perfil de responsável habilitado.");
    } catch {
      setNotice("Não foi possível atualizar os tipos de perfil. Tente novamente.");
    } finally { setBusy(false); }
  }

  async function saveProfession() {
    if (!supabase || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const { error } = await supabase.from("caa_profiles").update({
        professional_category: profession.category || null,
        professional_registration: profession.registration.trim() || null,
      }).eq("id", user.id).select("id").single();
      if (error) throw error;
      await load();
      setNotice("Dados profissionais salvos.");
    } catch {
      setNotice("Não foi possível salvar os dados profissionais.");
    } finally { setBusy(false); }
  }

  return <div className="mt-4 space-y-6">
    {options && user.role && <div className="space-y-3">
      <h3 className="font-semibold">Tipo de perfil</h3>
      <label className="grid gap-2 text-sm font-medium">
        Perfil em uso
        <select className="input-field" value={user.role} disabled={busy || options.roles.length < 2}
          onChange={(event) => void switchRole(event.target.value as AccountRole)}>
          {options.roles.map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}
        </select>
      </label>
      {!options.roles.includes("responsavel") && <button type="button" className="button-secondary"
        disabled={busy} onClick={() => void requestRole("responsavel")}>Habilitar perfil de responsável</button>}
      {!options.roles.includes("fonoaudiologo") && (options.professional_pending
        ? <p className="text-sm">Solicitação profissional em validação.</p>
        : <button type="button" className="button-secondary" disabled={busy} aria-expanded={requesting}
          onClick={() => setRequesting((current) => !current)}>Solicitar perfil profissional</button>)}
      {(requesting || user.role === "fonoaudiologo") && <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        if (requesting) void requestRole("fonoaudiologo");
        else void saveProfession();
      }}>
        <ProfessionalFields value={profession} onChange={setProfession} disabled={busy} />
        {user.role === "fonoaudiologo" && <p className="text-sm text-stone-600">
          {options.professional_pending ? "Categoria em validação"
            : options.professional_validated ? "Categoria validada" : "Categoria declarada"}
        </p>}
        <button type="submit" className="button-secondary"
          disabled={busy || options.professional_pending || (requesting && !profession.category)}>
          {requesting ? "Enviar para validação" : "Salvar dados profissionais"}
        </button>
        {user.role === "fonoaudiologo" && !options.professional_validated && !options.professional_pending
          && <button type="button" className="button-secondary ml-2" disabled={busy || !profession.category}
            onClick={() => void requestRole("fonoaudiologo")}>Solicitar validação profissional</button>}
      </form>}
    </div>}
    {notice && <p role="status">{notice}</p>}
    <AccountDeletion user={user} signOut={signOut} />
  </div>;
}
