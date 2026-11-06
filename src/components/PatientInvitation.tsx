import { useEffect, useRef, useState } from "react";
import { Mail, UserRoundPlus } from "lucide-react";
import type {
  CaaInvitation,
  Crianca,
  ProfessionalMember,
} from "../lib/database.types";
import {
  createInvitation,
  invitationMailto,
  listGuardianMembers,
  ProfessionalError,
  revokeMember,
} from "../lib/professional";

export function PatientInvitation({
  child,
  preview,
}: {
  child: Crianca | null;
  preview: boolean;
}) {
  const [invitation, setInvitation] = useState<CaaInvitation | null>(null);
  const [members, setMembers] = useState<ProfessionalMember[]>([]);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const context = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const request = ++context.current;
    setInvitation(null);
    setMembers([]);
    setError(null);
    setPending(false);
    if (!child || preview) {
      setLoading(false);
      return () => {
        context.current++;
      };
    }
    setLoading(true);
    void listGuardianMembers(child.id, controller.signal)
      .then((data) => {
        if (context.current === request) setMembers(data);
      })
      .catch((cause: unknown) => {
        if (context.current === request && !controller.signal.aborted)
          setError(
            cause instanceof ProfessionalError
              ? cause.message
              : "Não foi possível carregar os profissionais vinculados.",
          );
      })
      .finally(() => {
        if (context.current === request) setLoading(false);
      });
    return () => {
      context.current++;
      controller.abort();
    };
  }, [child?.id, preview, version]);

  async function generate() {
    if (!child || preview || pending) return;
    const request = context.current;
    setPending(true);
    setError(null);
    try {
      const data = await createInvitation(child.id);
      if (context.current === request) setInvitation(data);
    } catch (cause) {
      if (context.current === request)
        setError(
          cause instanceof ProfessionalError
            ? cause.message
            : "Não foi possível gerar o convite.",
        );
    } finally {
      if (context.current === request) setPending(false);
    }
  }

  async function revoke(professionalId: string) {
    if (!child || preview || pending) return;
    const request = context.current;
    setPending(true);
    setError(null);
    try {
      await revokeMember(child.id, professionalId);
      if (context.current === request)
        setMembers((current) =>
          current.filter((member) => member.professional_id !== professionalId),
        );
    } catch (cause) {
      if (context.current === request)
        setError(
          cause instanceof ProfessionalError
            ? cause.message
            : "Não foi possível remover o vínculo.",
        );
    } finally {
      if (context.current === request) setPending(false);
    }
  }

  return (
    <section className="surface p-6" aria-labelledby="patient-invitation-title">
      <div className="mb-3 flex items-center gap-2 text-brand-700">
        <UserRoundPlus size={20} aria-hidden="true" />
        <h2 id="patient-invitation-title" className="text-lg font-semibold">
          Acompanhamento profissional
        </h2>
      </div>
      {child ? (
        <p className="text-sm text-stone-600">
          Convide um profissional para acompanhar o histórico de{" "}
          <strong>{child.nome}</strong> e exportar relatórios. Ele terá acesso
          de consulta enquanto o vínculo estiver ativo.
        </p>
      ) : (
        <p className="text-sm text-stone-600">
          Selecione ou crie um perfil de criança para gerar um convite.
        </p>
      )}
      {preview && (
        <p className="mt-3 text-sm text-stone-600">
          Entre em uma conta para gerar convites e vincular profissionais.
        </p>
      )}
      <button
        type="button"
        className="button-primary mt-4"
        disabled={!child || preview || pending}
        onClick={() => void generate()}
      >
        {pending ? "Aguarde…" : "Gerar código de convite"}
      </button>
      <p className="mt-3 text-xs leading-5 text-stone-500">
        O código é de uso único e vale por 10 minutos. Gerar outro código invalida
        o anterior. O envio permite consultar o histórico e gerar relatórios
        deste perfil.
      </p>
      {invitation && (
        <div
          className="mt-4 rounded-2xl border border-brand-100 bg-brand-50 p-4"
          role="status"
        >
          <p className="text-sm font-medium">Código para o profissional</p>
          <p className="my-3 select-all font-mono text-3xl font-bold tracking-[.3em] text-brand-700">
            {invitation.code}
          </p>
          <p className="text-xs text-stone-600">
            Válido até{" "}
            {new Date(invitation.expires_at).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}{" "}
            (Brasília).
          </p>
          <a
            className="button-secondary mt-4 w-fit"
            href={invitationMailto(invitation.code, invitation.expires_at)}
          >
            <Mail size={17} aria-hidden="true" /> Preparar e-mail com convite
          </a>
          <p className="mt-2 text-xs text-stone-600">
            O cliente de e-mail será aberto para você escolher o destinatário e
            revisar o envio.
          </p>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 underline"
            onClick={() => setVersion((current) => current + 1)}
            disabled={pending}
          >
            Atualizar vínculos
          </button>
        </div>
      )}
      <h3 className="mt-6 font-semibold">Profissionais vinculados</h3>
      {loading ? (
        <p role="status" className="mt-2 text-sm text-stone-500">
          Carregando vínculos…
        </p>
      ) : members.length ? (
        <ul className="mt-3 space-y-3">
          {members.map((member) => (
            <li
              key={member.professional_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 p-3"
            >
              <div>
                <p className="text-sm font-semibold">
                  {member.professional_name}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  Vinculado em{" "}
                  {new Date(member.created_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <button
                type="button"
                className="button-secondary"
                disabled={pending}
                onClick={() => void revoke(member.professional_id)}
              >
                Remover vínculo
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-stone-500">
          Nenhum profissional vinculado a este perfil.
        </p>
      )}
    </section>
  );
}
