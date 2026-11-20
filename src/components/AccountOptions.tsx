import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { AuthUser } from "../auth/authTypes";

const categories = ["Fonoaudiólogo", "Terapeuta ocupacional", "Professor", "Outro profissional"];
export function AccountOptions({ user, signOut }: { user: AuthUser; signOut: () => Promise<void> }) {
  const [category, setCategory] = useState("");
  const [ready, setReady] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    setConfirmation(false);
    setEmail("");
    setNotice("");
    async function load() {
      if (!supabase) return;
      try {
        // Migration 009 adds the column and account RPC in one transaction.
        // Keep the additional controls unavailable until that schema is ready.
        const { data, error } = await supabase.from("caa_profiles").select("professional_category").eq("id", user.id)
          .abortSignal(controller.signal).single();
        if (controller.signal.aborted) return;
        if (error || !data) throw error;
        setCategory(data.professional_category ?? "");
        setReady(true);
      } catch {
        if (!controller.signal.aborted) setNotice("As opções de conta estão temporariamente indisponíveis. Tente novamente mais tarde.");
      }
    }
    void load();
    return () => controller.abort();
  }, [user.id, user.role]);
  async function save(value: string) {
    if (!supabase || !ready || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("caa_profiles").update({ professional_category: value || null })
        .eq("id", user.id).select("id").single();
      if (error) throw error;
      setCategory(value);
      setNotice("Categoria salva.");
    } catch { setNotice("Não foi possível salvar a categoria."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!supabase || !ready || busy || email.trim() !== user.email) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("delete_own_caa_account", { p_expected_user_id: user.id });
      if (error) throw error;
    } catch {
      setNotice("Não foi possível excluir a conta. Confira se existem fotos vinculadas e tente novamente.");
      setBusy(false);
      return;
    }
    try { await signOut(); } catch { /* The server has already deleted the session owner. */ }
    window.location.replace("/login");
  }
  if (!ready) return notice ? <p className="mt-4 text-sm" role="status">{notice}</p> : null;
  return <div className="mt-4 space-y-3">
    {user.role === "fonoaudiologo" && <label className="grid gap-2">Categoria profissional
      <select className="input-field" value={category} disabled={!ready || busy} onChange={event => void save(event.target.value)}>
        <option value="">Selecione</option>{categories.map(value => <option key={value}>{value}</option>)}
      </select></label>}
    {!confirmation ? <button className="button-secondary" onClick={() => setConfirmation(true)}>Excluir conta</button> :
      <div className="space-y-2"><p>A exclusão é definitiva. Os perfis de crianças desta conta, seus registros e vínculos serão removidos.</p>
        <label className="grid gap-2">Digite seu e-mail para confirmar<input className="input-field" value={email} type="email" onChange={event => setEmail(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><button className="button-secondary" disabled={busy} onClick={() => { setConfirmation(false); setEmail(""); }}>Cancelar</button>
        <button className="button-secondary text-red-800" disabled={busy || email.trim() !== user.email} onClick={() => void remove()}>Excluir definitivamente</button></div>
      </div>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
