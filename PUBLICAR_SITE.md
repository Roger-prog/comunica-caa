# Publicar o Comunica sem lojas

Use os planos gratuitos e os endereços fornecidos pelos serviços. Não é necessário comprar domínio. Confira os limites atuais antes de contratar qualquer serviço.

## 1. Contas e banco

Crie suas contas em [Supabase](https://supabase.com/dashboard/sign-up) e [Cloudflare](https://dash.cloudflare.com/sign-up). Escolha Free. Guarde senhas e códigos de recuperação com você.

No Supabase, crie um projeto numa organização Free. Escolha uma região próxima e uma senha forte para o banco, que não será usada no site. Aguarde o projeto ficar pronto.

Abra **SQL Editor**, crie uma consulta, copie todo `supabase/migrations/001_comunica.sql` e execute uma vez em um projeto novo. A migração não foi feita para reaplicação sobre tabelas existentes. Se ocorrer erro, guarde a mensagem antes de tentar novamente.

São criadas as tabelas `caa_profiles`, `caa_children`, `caa_members`, `caa_words` e `caa_events`, o gatilho de criação de perfil e a função `comunica_api`. RLS fica habilitado e o acesso direto às tabelas é negado. O site usa a função autenticada, que verifica a permissão para cada criança. Senhas são gerenciadas pelo Supabase Auth.

## 2. Configurar o site

Em **Connect** ou configurações de API, copie **Project URL** e a chave **Publishable**, iniciada por `sb_publishable_`. A chave legada `anon` também funciona. Nunca use `service_role`, `sb_secret_` ou senha do banco no site.

Extraia o pacote e abra PowerShell na pasta que contém `configurar-site.ps1`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\configurar-site.ps1
```

O comando permite executar esse script nesse processo, sem alterar permanentemente a política do Windows. Informe a URL e a chave pública. O script grava `config.json` e cria **comunica-site-configurado.zip**. O pacote inclui `site-compilado/` e não exige Flutter instalado.

A chave pública aparece no navegador; a proteção dos dados vem da autenticação e das permissões SQL. O script rejeita tipos conhecidos de chave privilegiada.

Alternativa manual: preencha `site-compilado/config.json`:

```json
{
  "supabaseUrl": "https://SEU-PROJETO.supabase.co",
  "supabasePublishableKey": "sb_publishable_SUA_CHAVE_PUBLICA",
  "turnstileSiteKey": "SITE_KEY_PUBLICA_DO_TURNSTILE",
  "emailRecoveryEnabled": false
}
```

Compacte o conteúdo de `site-compilado`, com `index.html` na raiz do ZIP. Não envie o projeto inteiro ou o SQL ao Pages.

## 3. Publicar

No Cloudflare, abra **Workers & Pages**, crie uma aplicação **Pages** e escolha upload direto (Direct Upload). Escolha um nome disponível, envie `comunica-site-configurado.zip` e publique. O endereço será semelhante a `https://seu-nome.pages.dev`.

O ZIP inclui `_headers` e `_redirects`. Não é necessário servidor Python, Worker ou domínio próprio. Para atualizar, faça outro deploy com o novo conteúdo compilado/configurado.

### Proteção do login com Turnstile

Crie um widget **Managed** em Cloudflare → Turnstile, permitindo somente o hostname do site (sem `https://`). Copie a **Site key pública** para `turnstileSiteKey` em `web/config.json`. O script de configuração preserva essa chave e também aceita o parâmetro `-TurnstileSiteKey`. A **Secret key** vai exclusivamente no painel Supabase, nunca no código, no ZIP, em `config.json` ou em um `--dart-define`.

Compile e publique o site com o widget antes de ativar a exigência no servidor. Depois, em Supabase → Authentication → Attack Protection, habilite CAPTCHA, selecione **Turnstile by Cloudflare** e salve a Secret key correspondente. O Supabase valida o token no servidor. Cadastro, login e recuperação exigem um token novo; tokens expirados e tentativas de reutilização são bloqueados. Se o serviço não carregar, a interface permite tentar uma nova verificação e não envia a autenticação sem token.

O build padrão usa `config.json`. Se compilar com `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` via `--dart-define`, inclua também `TURNSTILE_SITE_KEY` com a chave pública; nesse modo a configuração runtime não é lida. Para testar em outro hostname, permita-o explicitamente em um widget de desenvolvimento. Não publique as chaves fictícias de teste do Turnstile.

No provedor Email do Supabase, ajuste **Minimum password length** para **10**. Essa configuração é do servidor e não acompanha automaticamente o ZIP. Em Rate Limits, confira o limite de cadastro/login por IP: o projeto Comunica mantém **30 solicitações a cada 5 minutos**, considerando os alunos que usam a mesma rede.

Proteja também as contas administrativas: Supabase → Account → Security → Add app; Cloudflare → Profile → Access Management → Authentication → Mobile App Authentication. O titular deve concluir o cadastro do autenticador e guardar os códigos de recuperação.

## 4. Entrada e e-mails

No Supabase, em **Authentication → URL Configuration**, configure **Site URL** com o endereço HTTPS do Pages. Adicione nas URLs de redirecionamento permitidas a página inicial e `https://seu-nome.pages.dev/?recovery=1`. Para desenvolvimento, adicione também a origem local exata usada.

O SMTP padrão do Supabase restringe destinatários a membros da organização e tem limite baixo: não atende livremente ao cadastro e recuperação de toda a turma. Escolha a configuração adequada:

- Com confirmação: mantenha **Confirm email** habilitado e configure um SMTP próprio em Authentication. Confira custos e limites do provedor; não presuma envio gratuito ilimitado.
- Demonstração acadêmica com dados fictícios: você pode escolher desabilitar **Confirm email** no provedor Email. Cadastro e login passam a dispensar envio. Isso não verifica a propriedade do e-mail; não use essa configuração para dados reais de crianças. Recuperação por e-mail ainda depende de SMTP.

O código suporta cadastro com ou sem confirmação. A recuperação fica oculta por padrão. Após configurar e testar SMTP, habilite `"emailRecoveryEnabled": true` em `config.json` e publique a configuração atualizada. Não desabilite confirmação num projeto real para contornar falhas de SMTP.

## 5. Validar antes de compartilhar

Crie contas fictícias de responsável e profissional. Adicione uma criança fictícia, toque numa palavra, confira o histórico e registre uma avaliação manual. Recarregue para confirmar persistência. Autorize o profissional por e-mail e confira em outro navegador; revogue e confirme o bloqueio. Uma terceira conta não deve visualizar a criança. Baixe o CSV.

Repita no Chrome de um Android, no Safari de um iPhone e no computador: login, símbolos, voz, rolagem, avaliação, histórico e CSV. Mantenha o volume audível e toque diretamente no símbolo. Teste confirmação e recuperação se configurar SMTP. A integração com Supabase hospedado foi validada em 14/09/2026. O teste em iPhone real continua pendente.

## Problemas comuns e limites

- “Site em preparação”: confira `config.json` e `index.html` na raiz do ZIP.
- “Banco ainda não foi configurado”: confira a execução da migração no projeto correto.
- E-mail não chega: confira SMTP e os limites acima.
- Profissional sem acesso: o responsável precisa autorizar uma conta cadastrada como profissional.
- Acesso remoto exige internet; a fila de registros pendentes não substitui o banco nem backup.
- Supabase Free pode pausar projetos por inatividade. Confira o painel e reative antes da apresentação; exporte dados necessários para backup.

Referências: [Flutter Web](https://docs.flutter.dev/deployment/web), [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Supabase planos](https://supabase.com/pricing).
