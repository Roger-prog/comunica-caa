import type { ReactNode } from "react";
import { ArrowRight, MessageCircle, ShieldCheck, Volume2 } from "lucide-react";
import { Link } from "react-router-dom";

export const PUBLIC_CONTACT = {
  responsible: "Roger Oliveira da Cunha",
  email: "rogeroliveiradacunha587@gmail.com",
} as const;

function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#faf9f6] text-ink">
      <a
        href="#public-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3"
      >
        Ir para o conteúdo
      </a>
      <div className="mx-auto max-w-5xl px-5 py-7 sm:px-10 lg:py-10">
        <header className="flex flex-wrap items-center justify-between gap-5">
          <Link to="/sobre" className="inline-flex items-center gap-3 rounded-xl">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-600 text-white">
              <MessageCircle size={25} aria-hidden="true" />
            </span>
            <span className="text-xl font-bold tracking-tight">Comunica - CAA</span>
          </Link>
          <nav aria-label="Informações do Comunica" className="flex flex-wrap gap-2">
            <Link to="/sobre" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-brand-700">
              Sobre
            </Link>
            <Link to="/privacidade" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-brand-700">
              Privacidade
            </Link>
            <Link to="/login" className="button-secondary">Entrar</Link>
          </nav>
        </header>
        <main id="public-content" className="py-12 sm:py-16">{children}</main>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 py-6 text-sm text-stone-500">
          <span>Comunica - CAA</span>
          <Link to="/privacidade" className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-4">
            Política de privacidade
          </Link>
        </footer>
      </div>
    </div>
  );
}

export function AboutPage() {
  return (
    <PublicLayout>
      <section aria-labelledby="about-title">
        <p className="eyebrow">Comunicação Aumentativa e Alternativa</p>
        <h1 id="about-title" className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Símbolos e voz para comunicar escolhas.
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-stone-600">
          O Comunica é um sistema web de Comunicação Aumentativa e Alternativa.
          Sua prancha reúne símbolos para expressar necessidades, sentimentos,
          atividades e outras mensagens, com composição de frases e leitura em
          voz alta.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/cadastro" className="button-primary">
            Criar conta <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link to="/login" className="button-secondary">Acessar o Comunica</Link>
        </div>
      </section>
      <section aria-label="Recursos do Comunica" className="mt-12 grid gap-5 sm:grid-cols-3">
        <article className="surface p-6">
          <MessageCircle className="text-brand-600" size={27} aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold">Prancha de comunicação</h2>
          <p className="mt-3 text-sm leading-7 text-stone-600">
            Símbolos organizados por categorias, busca por palavras e frases
            formadas na ordem escolhida. O modo criança concentra a interface
            na comunicação e protege a saída com um PIN.
          </p>
        </article>
        <article className="surface p-6">
          <Volume2 className="text-brand-600" size={27} aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold">Leitura em português</h2>
          <p className="mt-3 text-sm leading-7 text-stone-600">
            Leitura dos símbolos e das frases com vozes em português do Brasil.
            A velocidade e o tamanho dos cartões podem ser ajustados no navegador.
          </p>
        </article>
        <article className="surface p-6">
          <ShieldCheck className="text-brand-600" size={27} aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold">Acompanhamento individual</h2>
          <p className="mt-3 text-sm leading-7 text-stone-600">
            O responsável organiza os perfis e acompanha o histórico. Profissionais
            vinculados por convite podem consultar os registros e exportar
            relatórios em PDF.
          </p>
        </article>
      </section>
      <section className="surface mt-8 p-6 sm:p-8" aria-labelledby="account-title">
        <h2 id="account-title" className="text-2xl font-semibold">Acesso à sua conta</h2>
        <p className="mt-4 max-w-3xl leading-8 text-stone-600">
          A conta pode ser criada com e-mail e senha ou pelo login Google. O
          nome, o e-mail e o identificador fornecidos na autenticação permitem
          reconhecer a conta e disponibilizar o perfil de responsável ou
          fonoaudiólogo. Os registros da prancha são associados aos perfis
          cadastrados pelo responsável.
        </p>
        <Link to="/privacidade" className="mt-4 inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-4">
          Consulte como os dados são utilizados
        </Link>
      </section>
    </PublicLayout>
  );
}

function PrivacySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8" aria-label={title}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 leading-8 text-stone-600">{children}</div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <PublicLayout>
      <article className="surface mx-auto max-w-3xl p-6 sm:p-10" aria-labelledby="privacy-title">
        <p className="eyebrow">Comunica - CAA</p>
        <h1 id="privacy-title" className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Política de privacidade
        </h1>
        <p className="mt-6 leading-8 text-stone-600">
          Esta política descreve os dados utilizados pelo Comunica para autenticar
          contas, disponibilizar a prancha de comunicação e permitir o acompanhamento
          dos perfis cadastrados.
        </p>
        <PrivacySection title="Responsável e contato">
          <p>Responsável pelo serviço — {PUBLIC_CONTACT.responsible}.</p>
          <p>Contato sobre privacidade — {PUBLIC_CONTACT.email}.</p>
        </PrivacySection>
        <PrivacySection title="Dados utilizados">
          <p>
            A autenticação utiliza o identificador da conta e o e-mail. No acesso
            com Google, o serviço de autenticação recebe informações básicas do
            perfil, incluindo nome e, quando fornecida pelo Google, foto de perfil.
            O perfil do Comunica contém o nome e o tipo de conta escolhido.
          </p>
          <p>
            O responsável informa os nomes dos perfis de crianças e utiliza a
            prancha. O sistema registra o símbolo selecionado, seu texto, sua
            categoria, a data e o perfil ao qual o registro pertence. Também
            armazena convites temporários e vínculos com profissionais.
          </p>
          <p>
            Preferências de voz, velocidade e tamanho dos cartões ficam no
            armazenamento do navegador. Informações de sessão permitem manter
            o acesso e concluir os fluxos de autenticação e recuperação de senha.
          </p>
        </PrivacySection>
        <PrivacySection title="Finalidades e acesso aos registros">
          <p>
            Esses dados são utilizados para reconhecer a conta, organizar os
            perfis, reproduzir mensagens, apresentar o histórico e os indicadores
            de uso e preparar relatórios. O login Google solicita acesso à
            identificação, ao e-mail e ao perfil básico para autenticação.
          </p>
          <p>
            O responsável acessa os perfis e registros associados à sua conta.
            O profissional acessa para consulta os pacientes vinculados por
            convite. O responsável pode remover o vínculo profissional.
          </p>
        </PrivacySection>
        <PrivacySection title="Serviços utilizados">
          <p>
            O Supabase fornece autenticação e armazenamento dos dados. A Vercel
            hospeda o site e a consulta de domínio usada na validação de e-mail.
            Essa consulta recebe o domínio do endereço informado. A Brevo realiza
            o envio das mensagens de confirmação de conta e recuperação de senha.
            O Google participa da autenticação quando essa opção é escolhida.
          </p>
          <p>
            Os áudios do vocabulário incluído são reproduzidos pelo navegador.
            Quando um texto adicional utiliza o serviço de síntese de voz
            configurado, esse texto é enviado ao serviço para gerar o áudio.
            Os relatórios PDF são preparados no navegador e baixados no
            dispositivo de quem os exporta.
          </p>
        </PrivacySection>
        <PrivacySection title="Conservação e solicitações">
          <p>
            Os dados permanecem armazenados para disponibilizar a conta, os
            perfis e o histórico do Comunica. Solicitações de acesso, correção
            ou exclusão devem ser encaminhadas ao contato de privacidade.
            O responsável pelo serviço avaliará a solicitação e informará o
            atendimento e a conservação aplicável aos dados envolvidos.
          </p>
          <p>
            O responsável que cadastra um perfil de criança deve ter autorização
            para fornecer esses dados. O compartilhamento dos registros com um
            profissional ocorre mediante vínculo por convite.
          </p>
        </PrivacySection>
      </article>
    </PublicLayout>
  );
}
