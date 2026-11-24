import type { AuthUser } from "../auth/authTypes";
import { AccountOptions } from "./AccountOptions";

/** Reuse the secured account actions already used by Settings. Never grant
 * child access from the professional role merely because a professional is linked. */
export function ProfessionalAccountSection({ user, signOut, onRoleChanged }: {
  user: AuthUser;
  signOut: () => Promise<void>;
  onRoleChanged: () => Promise<void>;
}) {
  return <div className="max-w-3xl space-y-6">
    <section className="surface p-5 sm:p-6" aria-labelledby="professional-account-heading">
      <h2 id="professional-account-heading" className="text-xl font-semibold">Gerenciar meu perfil</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        Escolha entre Responsável e Profissional quando os dois perfis estiverem habilitados.
        Informe sua área de atuação, solicite a validação profissional ou gerencie a exclusão da conta.
      </p>
      <p className="mt-4 font-semibold">{user.name}</p>
      <p className="break-all text-sm text-stone-500">{user.email}</p>
      <AccountOptions user={user} signOut={signOut} onRoleChanged={onRoleChanged} />
    </section>
    <section className="surface p-5 sm:p-6" aria-labelledby="co-guardians-info-heading">
      <h2 id="co-guardians-info-heading" className="text-lg font-semibold">Vários responsáveis por criança</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        Uma criança pode ter um responsável titular e vários corresponsáveis, cada um com sua conta.
        Os convites são gerados exclusivamente por um responsável autorizado, para proteger os dados do paciente.
      </p>
      <div className="mt-3 rounded-xl bg-brand-50 p-4 text-sm leading-6">
        Para convidar um corresponsável, use o perfil <strong>Responsável</strong>, abra
        <strong> Ajustes → Responsáveis vinculados → Adicionar corresponsável</strong> e gere um código
        associado ao e-mail do convidado. A pessoa convidada deve entrar em sua própria conta
        e resgatar o código em <strong>Ajustes → Vincular criança como corresponsável</strong>.
      </div>
      <p className="mt-3 text-sm text-stone-600">
        O código é de uso único e vale por uma hora. O vínculo começa com permissão de leitura;
        o titular pode conceder edição e gerenciamento separadamente. O profissional não recebe
        autorização para gerenciar corresponsáveis apenas por acompanhar a criança.
      </p>
    </section>
  </div>;
}
