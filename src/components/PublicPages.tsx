import { DemoBoard } from "./DemoBoard";
import type { ReactNode } from "react";
import { ArrowRight, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";

export const PUBLIC_CONTACT = {
  responsible: import.meta.env.VITE_CONTACT_NAME?.trim() || "Equipe Comunica",
  email: import.meta.env.VITE_CONTACT_EMAIL?.trim() || "Canal de contato ainda não informado",
} as const;

function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper text-ink">
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
            <Link to="/creditos" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-brand-700">
              Créditos
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
      <section className="public-hero" aria-labelledby="about-title">
        <div className="hero-copy">

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
        </div>
        <DemoBoard />
      </section>
      <section className="mt-10 space-y-3">
        <h2 className="text-3xl">Cores que ajudam a montar frases</h2>
        <p>Pessoas em amarelo, ações em verde, coisas em laranja, adjetivos em azul e expressões sociais em rosa. Na prancha acima, experimente formar “Eu quero água gelada, por favor”.</p>
      </section>
      <section className="mt-10 space-y-3"><h2 className="text-3xl">Quem acompanha a criança</h2>
        <p>O responsável organiza os símbolos do dia a dia. O profissional vinculado acompanha o uso da prancha e gera relatórios.</p>
      </section>
      <section className="surface mt-8 p-6 sm:p-8" aria-labelledby="account-title">
        <h2 id="account-title" className="text-2xl font-semibold">Privacidade e acesso à sua conta</h2>
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

export function CreditsPage() {
  return (
    <PublicLayout>
      <article className="surface mx-auto max-w-3xl p-6 sm:p-10">
        <h1 className="text-3xl font-semibold tracking-tight">Créditos dos pictogramas</h1>
        <p className="mt-5 leading-8 text-stone-700">
          Pictogramas de Sergio Palao, pertencentes ao Governo de Aragão e
          disponibilizados pelo ARASAAC sob licença Creative Commons BY-NC-SA.
        </p>
        <p className="mt-3 leading-8 text-stone-700">
          O uso comercial dos pictogramas exige autorização específica do titular.
          Obras derivadas desses recursos devem preservar a atribuição e a licença.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a className="button-secondary" href="https://arasaac.org/terms-of-use">Termos do ARASAAC</a>
          <a className="button-secondary" href="https://creativecommons.org/licenses/by-nc-sa/4.0/">Licença CC BY-NC-SA</a>
        </div>
        <section className="mt-8 border-t border-stone-200 pt-6" aria-labelledby="local-voice-credits">
          <h2 id="local-voice-credits" className="text-xl font-semibold">Vozes neurais locais</h2>
          <p className="mt-3 leading-7 text-stone-700">As vozes Faber e Edresson usam modelos do projeto Piper.</p>
          <a className="button-secondary mt-4" href="/piper-credits.txt">Créditos e licenças das vozes</a>
        </section>
      </article>
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

        <h1 id="privacy-title" className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Política de privacidade
        </h1>
        <p className="mt-6 leading-8 text-stone-600">
          Esta política descreve os dados utilizados pelo Comunica para autenticar
          contas, disponibilizar a prancha de comunicação e permitir o acompanhamento
          dos perfis cadastrados.
        </p>
        <PrivacySection title="Áudio de pronúncia e Libras">
          <p>As gravações de pronúncia ficam temporariamente no dispositivo. Ao abrir o intérprete de Libras, a frase escolhida fica disponível ao serviço VLibras para tradução.</p>
        </PrivacySection>
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
            prancha. Quando o histórico está ativo, o sistema registra as seleções
            de símbolos, inclusive símbolos próprios, e o texto das mensagens cuja
            leitura foi iniciada. Os registros incluem data, horário e perfil. As
            seleções incluem o rótulo e a categoria do símbolo. As fotos privadas
            ficam no armazenamento da prancha, sem cópias no histórico. Também são
            armazenados convites temporários e vínculos com profissionais.
          </p>
          <p>
            A personalização por paciente inclui preferências da prancha,
            símbolos próprios, frases faladas e, quando autorizadas, fotografias.
            Os ajustes gerais da demonstração ficam no navegador. Informações
            de sessão permitem manter o acesso e recuperar a senha.
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
            O profissional pode consultar o histórico dos pacientes vinculados
            por convite. A personalização e o acesso a fotografias exigem
            autorização separada no vínculo. O responsável pode retirar essa
            autorização ou revogar o vínculo. O servidor verifica o acesso
            em cada solicitação de foto.
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
            A busca no ARASAAC envia apenas termos escolhidos do vocabulário
            público. A prancha usa gravações incluídas ou gera a voz no
            dispositivo. O primeiro uso pode baixar arquivos do modelo de voz.
            O texto falado fica no dispositivo durante a síntese.
            Os relatórios PDF são preparados no navegador e baixados no
            dispositivo de quem os exporta.
          </p>
        </PrivacySection>
        <PrivacySection title="Conservação e solicitações">
          <p>
            Os dados permanecem armazenados para disponibilizar a conta, os
            perfis e o histórico do Comunica. Nos ajustes de cada perfil, o
            responsável pode pausar novos registros e excluir todo o histórico
            ou apenas registros anteriores a um período. Relatórios já baixados
            são cópias locais. Outras solicitações de acesso, correção ou
            exclusão podem ser encaminhadas ao contato de privacidade.
            O responsável pelo serviço avaliará a solicitação e informará o
            atendimento e a conservação aplicável aos dados envolvidos.
          </p>
          <p>
            Quem inclui uma foto confirma que possui autorização para usá-la
            na prancha. Considere a pessoa retratada e seu responsável legal,
            quando aplicável. Ao substituir ou excluir uma foto, ela deixa de
            ficar disponível na prancha e é encaminhada para remoção.
          </p>
        </PrivacySection>
      </article>
    </PublicLayout>
  );
}
