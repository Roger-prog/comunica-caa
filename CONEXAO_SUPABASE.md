# Conexão do Comunica ao novo Supabase

Atualização de 03/10/2026. Projeto `fpkusvjaglyhmjfjyyho`, organização TELEMED, banco PostgreSQL e autenticação Supabase Auth.

## Estado da instalação

A migração `supabase/migrations/001_comunica.sql` foi executada uma vez no novo banco. As cinco tabelas, as regras de acesso, o trigger de criação de perfil e a RPC da aplicação estão instalados. A conferência inicial encontrou zero usuários e zero registros nas tabelas da aplicação. Os dados antigos não foram importados; cada pessoa deve se cadastrar novamente.

O código local foi configurado para este projeto. A instalação da estrutura e os 10 testes SQL isolados passaram. A API hospedada rejeitou acesso anônimo à tabela e à RPC, além de um login com credenciais fictícias; nenhum usuário foi criado nem e-mail enviado. A versão compilada carregou o formulário de login local e exibiu “E-mail ou senha incorretos.” na tentativa com credenciais fictícias inexistentes. Cadastro, confirmação de e-mail e funcionamento completo com uma conta nova ainda precisam ser validados. O site continua fora do ar: a conexão do banco não criou uma hospedagem nova.

## O que o banco guarda

| Tabela | Dados da aplicação |
|---|---|
| `caa_profiles` | Nome, papel de responsável ou fonoaudiólogo, referência ao usuário do Supabase Auth e data do consentimento. |
| `caa_children` | Nome da criança, responsável proprietário e data de criação. |
| `caa_members` | Profissionais autorizados a acessar cada criança. |
| `caa_words` | Palavras, símbolos, categorias e indicação de vocabulário ativo por criança. |
| `caa_events` | Usos da prancha e avaliações manuais de evolução, autor, observação, palavra, etapa e data. |

O Supabase Auth mantém as contas e a autenticação. As tabelas da aplicação não armazenam a senha em texto. O aplicativo não grava áudio nem vídeo. Relatórios são calculados a partir dos registros de uso e evolução.

O Flutter envia cadastro e login ao Supabase Auth. Após entrar, chama a função SQL `comunica_api` para ler e alterar os dados; essa função confere o responsável ou a autorização do profissional para cada criança. O acesso direto às tabelas está bloqueado, mesmo para usuários autenticados. Tocar em um símbolo registra uso, sem atribuir automaticamente fala ou domínio.

## Configuração local

O arquivo `web/config.json` contém a URL do projeto e uma chave pública publishable ou anon. No repositório GitHub, esse arquivo é ignorado pelo Git. A cópia pública contém apenas `web/config.example.json`, sem os valores do ambiente. Não coloque senha do banco, chave Secret ou `service_role` nesse arquivo nem no GitHub.

Na cópia local já configurada, mantenha `turnstileSiteKey` vazio: o novo projeto ainda não tem CAPTCHA configurado. `emailRecoveryEnabled` permanece `false` até configurar e validar SMTP e recuperação. A confirmação de e-mail está ativa e a senha precisa ter pelo menos 10 caracteres. O cadastro exige confirmar o endereço antes do primeiro login.

Ao baixar a cópia do GitHub, copie o exemplo e preencha apenas os valores públicos do seu projeto:

```powershell
Copy-Item web/config.example.json web/config.json
```

Não execute novamente a migração no banco já instalado. Ela foi escrita para uma instalação em banco novo.

## Executar no computador

Com o Flutter instalado, abra o terminal na pasta do projeto:

```powershell
flutter pub get
flutter run -d chrome
```

É necessário acesso à internet para falar com o Supabase. A API Python não é necessária para esta configuração. A opção `USE_LOCAL_API=true` seleciona a alternativa antiga e não deve ser usada para testar esta conexão.

Para compilar uma nova versão:

```powershell
flutter build web --release --no-web-resources-cdn
```

Para visualizar uma versão já compilada, sirva `build/web` por HTTP. Por exemplo, se Python estiver instalado:

```powershell
python -m http.server 8080 --bind 127.0.0.1 --directory build/web
```

Abra `http://127.0.0.1:8080` no navegador. Esse endereço foi salvo como Site URL no Supabase para o retorno da autenticação durante os testes locais. Para usar Flutter no mesmo endereço, execute `flutter run -d chrome --web-hostname 127.0.0.1 --web-port 8080`, com o servidor Python encerrado. Na entrega que contém `site-compilado/`, use essa pasta no lugar de `build/web`. O endereço local funciona somente no computador em que o servidor foi iniciado; não disponibiliza o site à turma. A pasta servida precisa conter seu `config.json` atualizado. Após recompilar, execute `configurar-site.ps1` com a URL e a chave pública e passe `-TurnstileSiteKey ''` explicitamente para não reaproveitar a Site key antiga.

A publicação futura exige configurar a hospedagem e os endereços de retorno de autenticação, além de validar confirmação de e-mail e, caso seja configurado, CAPTCHA. O guia [PUBLICAR_SITE.md](PUBLICAR_SITE.md) descreve a publicação; esse passo não foi executado na troca de banco.

## Validação e segurança

[VALIDACAO_WEB.md](VALIDACAO_WEB.md) separa o que foi conferido no banco novo dos testes históricos. [SEGURANCA.md](SEGURANCA.md) registra as proteções e as pendências atuais, incluindo MFA administrativo ainda desativado na nova conta. Configurações do painel antigo não são transferidas automaticamente para a nova conta ou o novo projeto.
