# Segurança do Comunica

## Situação atual — novo projeto, 03/10/2026

O Comunica foi conectado ao projeto Supabase `fpkusvjaglyhmjfjyyho`, da organização TELEMED. A instalação é nova: os usuários e os dados anteriores não foram importados. No momento da instalação, as cinco tabelas da aplicação e `auth.users` estavam vazias. As pessoas precisam se cadastrar novamente no aplicativo.

- As cinco tabelas têm RLS ativo e não concedem acesso direto a visitantes nem aos usuários autenticados. A função `comunica_api` permite execução somente por usuários autenticados e verifica a autorização para cada criança. O trigger `comunica_new_user` cria o perfil após o cadastro no Supabase Auth.
- A senha mínima de 10 caracteres foi salva no provedor Email do novo projeto. A confirmação de e-mail está ativa; o cadastro exige confirmar o endereço antes do primeiro login.
- O CAPTCHA permanece desativado no novo projeto, onde ainda não foi configurado. A configuração local usa `turnstileSiteKey` vazio. A configuração Turnstile do projeto antigo não acompanha esta instalação.
- A recuperação por e-mail permanece oculta (`emailRecoveryEnabled: false`), pois SMTP e o fluxo de recuperação não foram validados neste projeto.
- A organização mostra MFA administrativo desativado para a nova conta. O 2FA da conta anterior não acompanha a troca de conta; não confundir o MFA do painel com o dos usuários do aplicativo.
- A hospedagem Cloudflare Pages anterior foi excluída em 01/10/2026. O site continua fora do ar; conectar o banco não republicou o site.

A verificação do banco confirmou as tabelas, o RLS, o trigger e a permissão da RPC (`authenticated`: permitida; `anon`: negada). Os 10 testes SQL em PostgreSQL via PGlite passaram novamente. Na API hospedada, acesso direto à tabela e execução anônima da RPC foram negados; o login fictício retornou credenciais inválidas. Os testes não criaram usuários nem enviaram e-mails. Cadastro, confirmação de e-mail e uso completo com uma conta nova ainda precisam de validação integrada. Veja [CONEXAO_SUPABASE.md](CONEXAO_SUPABASE.md) e [VALIDACAO_WEB.md](VALIDACAO_WEB.md).

## Registro histórico — projeto Supabase anterior

O relato abaixo documenta o projeto antigo `zisamfsvdlnvezzektew` e a hospedagem já retirada. Seus resultados de publicação, CAPTCHA, MFA e confirmação de e-mail não descrevem a configuração do novo projeto.

Atualização de 01/10/2026 para a demonstração acadêmica.

**Status da hospedagem:** o projeto `comunica-faculdade` do Cloudflare Pages foi excluído em 01/10/2026, por solicitação e confirmação do titular. O site e suas versões publicadas foram retirados do ar. O código-fonte local e o projeto Supabase foram preservados. As verificações de publicação descritas abaixo são o registro da validação anterior à retirada.

### Configurações do projeto hospedado

- A conta administrativa da Cloudflare tem autenticação em duas etapas ativa, confirmada no painel.
- A conta administrativa do Supabase tem autenticação em duas etapas ativa, cadastrada pelo titular e confirmada no painel em 01/10/2026. Isso é diferente de ativar MFA para os usuários do aplicativo.
- O provedor Email do Supabase exige senha com pelo menos 10 caracteres. A regra foi salva no servidor e conferida novamente no painel; o frontend usa o mesmo mínimo. Senhas já existentes não são alteradas por essa configuração.
- O limite de cadastro e login foi revisado e mantido em 30 solicitações a cada 5 minutos por IP. O limite de renovação de sessão permanece em 150/5 minutos e o de verificações OTP em 30/5 minutos. Essa escolha considera o acesso da turma pela mesma rede.
- O widget Turnstile usa modo Managed e permite somente `comunica-faculdade.pages.dev`, sem pre-clearance. A Secret key deve existir somente no painel Supabase; `config.json` contém a Site key pública.
- A atualização foi publicada em `https://comunica-faculdade.pages.dev/`. O widget foi conferido na URL de produção e o CAPTCHA Turnstile foi ativado no Supabase depois da publicação. A configuração permaneceu ativa após recarregar o painel.

### Código e validação

Cadastro, login e recuperação enviam `captchaToken` ao Supabase. Com a Site key configurada, o adapter não envia autenticação sem token. O controlador descarta tokens usados, expirados ou inválidos e renova a verificação após cada tentativa. Erros de CAPTCHA aparecem em português.

Foram aprovados 12 testes Flutter (incluindo cinco casos novos do controlador/adapter), `flutter analyze` e a verificação sintática do bridge JavaScript. A revisão independente não encontrou bloqueadores no lifecycle do widget.

Foi executada uma nova compilação de release com `flutter build web --release --no-web-resources-cdn`, concluída com sucesso. O aviso do dry run de WebAssembly do plugin de voz não impede a versão JavaScript publicada.

Após restabelecer o acesso à rede, os testes diretos na API hospedada confirmaram:

- Senha de 9 caracteres: rejeitada com HTTP 422, `weak_password` e exigência de pelo menos 10 caracteres, antes de ativar o CAPTCHA. Nenhuma conta foi criada.
- Login sem token e com token inválido: rejeitados com HTTP 400 e `captcha_failed`.
- Cadastro sem token: rejeitado com HTTP 400 e `captcha_failed`. Nenhuma conta foi criada.
- Formulário publicado com token real: a verificação foi concluída, o token passou no servidor e a conta fictícia inexistente foi rejeitada com “E-mail ou senha incorretos.”. Uma nova verificação começou após a tentativa.

Não foram executadas tentativas em massa para testar rate limiting. A recuperação segue oculta; o envio de token nessa rota foi verificado no código e nos testes do adapter, sem envio de e-mails no projeto hospedado. O teste em iPhone real continua pendente, conforme `VALIDACAO_WEB.md`.

### Configuração de demonstração

A confirmação de e-mail continua desativada por escolha expressa do titular para demonstração com dados fictícios. A recuperação por e-mail permanece oculta até configurar e validar SMTP. A opção de rejeitar senhas conhecidas em vazamentos exige plano Pro e não foi contratada.

Para republicar ou configurar outro projeto, siga `PUBLICAR_SITE.md`: primeiro publique o widget funcionando, depois ative o CAPTCHA no Supabase com a chave privada correspondente. As configurações administrativas e a política de senha não são aplicadas apenas por enviar o ZIP ao Pages.

Referências: [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha), [Supabase senhas](https://supabase.com/docs/guides/auth/password-security), [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).
