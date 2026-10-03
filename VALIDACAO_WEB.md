# Validação da versão Web

## Conexão atual — 03/10/2026

O código local usa o novo projeto Supabase `fpkusvjaglyhmjfjyyho`, da organização TELEMED. A migração foi aplicada com sucesso em um banco vazio, sem importar os dados antigos. A hospedagem anterior continua excluída; o site está fora do ar.

Verificações concluídas nesta instalação:

- As cinco tabelas (`caa_profiles`, `caa_children`, `caa_members`, `caa_words` e `caa_events`) foram criadas, têm RLS ativo e estavam vazias na conferência. `auth.users` também tinha zero usuários.
- O trigger `comunica_new_user` está instalado em `auth.users`.
- A RPC `comunica_api` permite execução pelo papel `authenticated` e nega execução ao papel `anon`.
- `npm test --prefix supabase`: 10 testes SQL passaram novamente em PostgreSQL via PGlite. Esses testes são isolados e não equivalem a um cadastro completo no Supabase Auth hospedado.
- No painel, a confirmação de e-mail está ativa, o CAPTCHA não foi configurado e a senha mínima de 10 caracteres foi salva.
- API hospedada: leitura direta de tabela e chamada anônima da RPC rejeitadas com HTTP 401 e código SQL `42501`. Login com credenciais fictícias inexistentes rejeitado com HTTP 400 e `invalid_credentials`. Os três testes passaram sem criar usuários ou enviar e-mails.
- Navegador local: a versão compilada carregou o formulário de login usando a configuração do novo projeto. A tentativa com credenciais fictícias inexistentes exibiu “E-mail ou senha incorretos.”, sem criar usuários.

Cadastro de uma conta nova, recebimento e abertura do link de confirmação, login confirmado e os fluxos completos da aplicação continuam pendentes. A recuperação de senha permanece oculta e não foi validada. Testes de sessão longa, Safari/iPhone, aparelhos Android, voz e download de CSV também continuam pendentes.

Veja [CONEXAO_SUPABASE.md](CONEXAO_SUPABASE.md) para configuração e execução local. O registro abaixo pertence à implementação e ao projeto anteriores; não é comprovação de funcionamento completo no novo projeto.

## Registro histórico — validação de 14/09/2026 e projeto anterior

### Verificações concluídas

- `flutter analyze`: sem problemas.
- `flutter test`: 7 testes aprovados, incluindo validação de entrada, fila persistente por usuário/criança, separação entre uso e avaliação, tela compacta com texto ampliado, rejeição de chaves privilegiadas e CSV com acentos/aspas/proteção contra fórmulas.
- `npm test --prefix supabase`: 10 verificações aprovadas executando a migração completa em PostgreSQL via PGlite. Cobrem acesso anônimo, isolamento por criança, bloqueio de escrita direta e de mudança de papel, autorização/revogação de profissional, idempotência, entradas inválidas, arquivamento, paginação e períodos UTC.
- `flutter build web --release --no-web-resources-cdn`: compilação JavaScript de produção concluída. A checagem experimental Wasm avisa sobre a dependência flutter_tts; este pacote usa JavaScript, não a opção `--wasm`.
- Navegador local: login, perfil, prancha, registro de uso e sua presença no histórico, persistência após recarregar, evolução com contagem correta e domínio não atribuído automaticamente. Conferência visual em desktop e viewport de 390 × 844, com duas colunas de símbolos no celular.
- Script PowerShell: configuração com valores fictícios, geração do ZIP e rejeição de chave secreta verificadas numa pasta de teste.

### Limites da validação

A navegação local usou a API Python de desenvolvimento e uma conta fictícia. Os testes SQL exercitaram o PostgreSQL isoladamente, simulando auth.users e auth.uid; não substituem a integração com Supabase Auth e PostgREST hospedados.

A configuração das contas, migração, publicação e integração de cadastro/login foram concluídas posteriormente, conforme o registro abaixo. Permanecem pendentes renovação automática de sessão de longa duração, links de confirmação/recuperação e teste real no Safari/iPhone e nos Androids da turma. A captura de download do navegador integrado não confirmou arquivo salvo, embora a solicitação CSV tenha retornado 200 e o gerador tenha passado no teste; valide o download no navegador final. Reprodução audível deve ser conferida nos aparelhos.

Não há garantia de funcionamento perfeito em qualquer aparelho. O objetivo é suportar navegadores modernos; vozes e aparência dos emojis variam conforme o sistema.

`VALIDACAO.md` registra a versão nativa anterior e não comprova a versão Web hospedada.

### Publicação realizada em 14/09/2026

Site: https://comunica-faculdade.pages.dev/
Projeto Supabase: Comunica (zisamfsvdlnvezzektew), organização Comunica Faculdade, plano Free.
Migração aplicada com sucesso no banco hospedado. Site URL e retornos de autenticação configurados para o domínio acima.

Confirmação de e-mail desativada com autorização do usuário, exclusivamente para demonstração acadêmica com dados fictícios. SMTP externo não configurado. O botão de recuperação de senha fica oculto por padrão; após configurar e testar SMTP, adicione `"emailRecoveryEnabled": true` a `config.json` e publique a configuração atualizada. Não compartilhe senhas do painel ou do banco com os alunos; cada pessoa cria sua conta dentro do site.

Validação hospedada: cadastro de três contas técnicas fictícias, login por senha, leitura de perfil, criação de criança com 16 palavras, registro idempotente de uso, histórico, relatório sem domínio automático, bloqueio de terceiros, autorização e revogação de profissional. Acesso direto às tabelas negado tanto para visitantes quanto para usuários autenticados. Testes executados usando somente a chave pública e sessões normais, sem chave administrativa.

As contas de teste são privadas e seus e-mails têm o prefixo comunica- e domínio example.com; não são contas para distribuir à turma. Os usuários reais verão apenas os próprios perfis e os que forem autorizados.

No site público, a conta fictícia entrou pelo formulário, carregou a prancha, registrou Comer e exibiu esse uso no histórico vindo do Supabase. Logout confirmado. Após ajuste de recuperação, análise estática e 7 testes Flutter passaram novamente.
