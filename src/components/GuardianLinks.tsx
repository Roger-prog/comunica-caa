import { useEffect, useState, type FormEvent } from "react";
import type { GuardianAccess, GuardianMember } from "../lib/database.types";
import { supabase } from "../lib/supabase";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });
const expiryFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
});
const ownerAccess: GuardianAccess = { is_owner: true, can_edit: true, can_manage_links: true };

export function useGuardianAccess(patientId: string | undefined, isOwner: boolean) {
  const [loaded, setLoaded] = useState<{ id: string; access: GuardianAccess | null } | null>(null);
  useEffect(() => {
    if (!supabase || !patientId || isOwner) return;
    const client = supabase;
    let pending: AbortController;
    function refresh(id: string) {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      void (async () => {
        try {
          const { data } = await client.rpc("get_caa_guardian_access", { p_crianca_id: id })
            .abortSignal(controller.signal).maybeSingle();
          if (!controller.signal.aborted) setLoaded({ id, access: data });
        } catch {
          if (!controller.signal.aborted) setLoaded({ id, access: null });
        }
      })();
    }
    const onFocus = () => refresh(patientId);
    onFocus();
    window.addEventListener("focus", onFocus);
    return () => {
      pending.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [patientId, isOwner]);
  if (!patientId) return null;
  if (isOwner) return ownerAccess;
  return loaded?.id === patientId ? loaded.access : null;
}

export function GuardianLinks({ patientId, access }: { patientId: string; access: GuardianAccess }) {
  const [members, setMembers] = useState<GuardianMember[]>([]);
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { data, error } = await client.rpc("list_caa_guardians", { p_crianca_id: patientId })
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error) throw error;
        setMembers(data ?? []);
      } catch {
        if (!controller.signal.aborted) setNotice("Não foi possível carregar os responsáveis vinculados.");
      }
    })();
    return () => controller.abort();
  }, [patientId, revision]);

  async function inviteGuardian(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy || !access.can_manage_links) return;
    setBusy(true);
    setNotice("");
    setInvite(null);
    try {
      const { data, error } = await supabase.rpc("create_caa_guardian_invitation", {
        p_crianca_id: patientId, p_email: email.trim(),
      }).single();
      if (error || !data) throw error ?? new Error("invitation");
      setInvite(data);
    } catch {
      setNotice("Não foi possível gerar o convite. Confira o e-mail e suas permissões.");
    } finally { setBusy(false); }
  }

  async function changeMember(member: GuardianMember, permissions?: { can_edit: boolean; can_manage_links: boolean }) {
    if (!supabase || busy || !access.can_manage_links) return;
    setBusy(true);
    setNotice("");
    const args = { p_crianca_id: patientId, p_guardian_id: member.guardian_id };
    try {
      const { data, error } = await (permissions
        ? supabase.rpc("set_caa_guardian_permissions", {
          ...args, p_can_edit: permissions.can_edit, p_can_manage_links: permissions.can_manage_links,
        })
        : supabase.rpc("revoke_caa_guardian", args));
      if (error || !data) throw error ?? new Error("guardian_permissions");
      setRevision((current) => current + 1);
      setNotice(permissions ? "Permissões atualizadas." : "Acesso revogado.");
    } catch {
      setNotice("Não foi possível alterar o vínculo. Atualize a lista e tente novamente.");
    } finally { setBusy(false); }
  }

  return <section className="surface space-y-4 p-6" aria-labelledby="guardians-heading">
    <h2 id="guardians-heading" className="text-lg font-semibold">Responsáveis vinculados</h2>
    <p className="text-sm leading-6 text-stone-600">Cada criança pode ter vários responsáveis. Gere um código de convite para cada nova pessoa e acompanhe suas permissões abaixo.</p>
    {access.can_manage_links && <form className="space-y-3" onSubmit={(event) => void inviteGuardian(event)}>
      <h3 className="font-semibold">Adicionar corresponsável</h3>
      <p className="text-sm text-stone-600" id="guardian-invite-note">
        O código vale por uma hora e só pode ser usado uma vez pela conta com esse e-mail confirmado.
        O novo vínculo começa com permissão de visualização. Gere o próximo convite depois que o anterior for utilizado;
        um novo código substitui qualquer convite pendente da mesma criança.
      </p>
      <label className="grid gap-2 text-sm font-medium">E-mail do corresponsável
        <input className="input-field" type="email" autoComplete="off" maxLength={254} required disabled={busy}
          aria-describedby="guardian-invite-note" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <button className="button-primary" type="submit" disabled={busy}>Gerar código de corresponsável</button>
    </form>}
    {invite && <div className="rounded-xl bg-brand-50 p-4" role="status">
      <p>Código de convite</p>
      <p className="select-all break-all font-mono font-semibold">{invite.code}</p>
      <p className="text-sm">Válido até {expiryFormat.format(new Date(invite.expires_at))} (horário de Brasília).</p>
    </div>}
    <button type="button" className="button-secondary" disabled={busy}
      onClick={() => { setNotice(""); setRevision((current) => current + 1); }}>Atualizar responsáveis</button>
    {members.length > 0 && <ul className="space-y-3">
      {members.map((member) => <li key={member.guardian_id} className="space-y-2 rounded-xl border border-stone-200 p-3">
        <p className="break-words font-semibold">{member.guardian_name}</p>
        <p className="text-sm text-stone-600">
          {member.is_owner ? "Responsável titular" : "Corresponsável"} · {dateFormat.format(new Date(member.created_at))}
        </p>
        <p className="text-sm">Visualização{member.can_edit && ", edição"}{member.can_manage_links && ", gerenciamento de vínculos"}</p>
        {!member.is_owner && access.is_owner && <div className="flex flex-wrap gap-x-4">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={member.can_edit} disabled={busy}
              aria-label={`Autorizar edição para ${member.guardian_name}`}
              onChange={(event) => void changeMember(member, { ...member, can_edit: event.target.checked })} />
            Permitir edição
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={member.can_manage_links} disabled={busy}
              aria-label={`Autorizar gerenciamento para ${member.guardian_name}`}
              onChange={(event) => void changeMember(member, { ...member, can_manage_links: event.target.checked })} />
            Permitir gerenciar vínculos
          </label>
        </div>}
        {!member.is_owner && (access.is_owner || (access.can_manage_links && !member.can_manage_links)) && <button
          type="button" className="button-secondary" disabled={busy}
          aria-label={`Revogar acesso de ${member.guardian_name}`} onClick={() => void changeMember(member)}>
          Revogar acesso
        </button>}
      </li>)}
    </ul>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}

export function LinkGuardian({ onLinked }: { onLinked: (patientId: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const { data, error } = await supabase.rpc("redeem_caa_guardian_invitation", { p_code: code.trim() });
      if (error) throw error;
      if (!data) {
        setNotice("O código é inválido, já foi usado, expirou ou foi emitido para outro e-mail.");
        return;
      }
      setCode("");
      setNotice("Criança vinculada à sua conta.");
      onLinked(data);
    } catch {
      setNotice("Não foi possível vincular a criança. Confira sua sessão e tente novamente.");
    } finally { setBusy(false); }
  }

  return <section className="surface p-6" aria-labelledby="link-guardian-heading">
    <h2 id="link-guardian-heading" className="mb-3 text-lg font-semibold">Vincular criança como corresponsável</h2>
    <form className="space-y-3" onSubmit={(event) => void redeem(event)}>
      <label className="grid gap-2 text-sm font-medium">Código de corresponsável
        <input className="input-field" autoCapitalize="none" spellCheck={false} required maxLength={32}
          disabled={busy} value={code} onChange={(event) => setCode(event.target.value)} />
      </label>
      <button className="button-secondary" type="submit" disabled={busy || code.trim().length !== 32}>Vincular criança</button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
  </section>;
}
