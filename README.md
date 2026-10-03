# Comunica — Comunicação Aumentativa e Alternativa

Projeto acadêmico em Flutter, com interface Web, autenticação pelo Supabase Auth e banco SQL PostgreSQL. A aplicação oferece uma prancha de comunicação com símbolos, síntese de voz e acompanhamento de uso e evolução.

## Funcionalidades

- Cadastro e login de responsáveis e fonoaudiólogos.
- Perfis de crianças e vocabulário personalizado com palavras, emojis e categorias.
- Prancha com voz do navegador e fila de seleções que aguardam envio.
- Avaliação manual: CAA utilizada, tentativa de vocalização, palavra falada e domínio da palavra.
- Histórico, relatórios por período e exportação CSV.
- Autorização e revogação de acesso dos profissionais pelo responsável.
- Verificação Turnstile nos fluxos de autenticação quando configurada.

Selecionar um símbolo registra uso da prancha; não confirma automaticamente fala ou domínio. A aparência dos emojis e as vozes disponíveis dependem do dispositivo. O sistema não realiza diagnóstico nem grava áudio ou vídeo.

## Executar a versão Web

Instale o Flutter e crie um projeto Supabase. Execute a migração `supabase/migrations/001_comunica.sql` uma única vez em um banco novo. Configure autenticação e endereços de retorno no painel Supabase. Se usar Turnstile, configure o widget e a validação correspondente no Supabase.

Copie o exemplo de configuração:

```powershell
Copy-Item web/config.example.json web/config.json
```

Edite `web/config.json`, informando `supabaseUrl`, `supabasePublishableKey` e a Site key pública em `turnstileSiteKey`. Use uma chave publishable ou anon; senhas, Secret keys e service_role não pertencem a esse arquivo. A configuração local não é versionada.

Execute:

```powershell
flutter pub get
flutter run -d chrome
```

A aplicação usa diretamente o Supabase; a API Python é necessária somente para a alternativa local. Sem configuração válida, a interface mostra “Site em preparação”.

Na demonstração acadêmica configurada, a confirmação de e-mail foi desativada com autorização do titular para uso de dados fictícios. O endereço informado não é verificado; a senha precisa ter pelo menos 10 caracteres. Para uma instalação com confirmação de e-mail, configure um serviço SMTP próprio e valide o envio antes de liberar os cadastros.

## Compilar e publicar

```powershell
flutter build web --release --no-web-resources-cdn
```

Os arquivos compilados ficam em `build/web/`. Para preparar o ZIP do Cloudflare Pages, execute `configurar-site.ps1` com a URL, a chave pública do Supabase e a Site key pública do Turnstile. Quando CAPTCHA não estiver configurado, passe `-TurnstileSiteKey ''` explicitamente.

O repositório contém código-fonte; builds, dados locais, capturas de tela e configuração do ambiente ficam fora do Git.

## Estrutura

| Diretório | Conteúdo |
|---|---|
| `lib/` | Interface Flutter, autenticação e integração com Supabase. |
| `web/` | Página inicial, integração Turnstile e configuração de hospedagem. |
| `supabase/migrations/` | Tabelas, funções SQL e regras de acesso. |
| `supabase/tests/` | Testes das regras SQL. |
| `test/` e `integration_test/` | Testes Flutter e de integração. |
| `android/` e `ios/` | Estrutura nativa Flutter. |
| `server/` | API Python com SQLite, alternativa para execução local. |

As instruções da alternativa local estão em [README_NATIVO.md](README_NATIVO.md). Ela usa `--dart-define=USE_LOCAL_API=true` e não sincroniza automaticamente o SQLite com o PostgreSQL.

## Verificações

```powershell
flutter analyze
flutter test
npm ci --prefix supabase
npm test --prefix supabase
```

O teste em iPhone real permanece pendente; valide os fluxos e a voz nos aparelhos usados na disciplina.
