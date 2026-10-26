# Comunica — CAA

Comunica é um sistema web de Comunicação Aumentativa e Alternativa (CAA). A aplicação permite expressar necessidades, sentimentos e escolhas por meio de uma prancha visual com leitura em voz alta.

## Funcionalidades

- Prancha com 24 símbolos organizados em seis categorias, com busca por palavras.
- Leitura do símbolo selecionado e composição de frases com até 12 símbolos.
- Cadastro e autenticação de usuários.
- Perfis individuais de crianças e registro das comunicações por perfil.
- Histórico e indicadores de utilização em períodos de 7 ou 30 dias.
- Ajustes de voz, velocidade da fala e tamanho dos cartões.
- Interface responsiva, navegação por teclado e identificação textual dos símbolos.
- Demonstração interativa sem cadastro, com dados temporários mantidos apenas durante a sessão.

Os indicadores representam o uso da prancha. Não constituem diagnóstico, avaliação clínica ou comprovação de domínio de palavras. A aparência dos símbolos e a disponibilidade das vozes variam conforme o navegador e o sistema operacional.

## Arquitetura

O front-end é uma aplicação React com TypeScript, compilada pelo Vite e estilizada com Tailwind CSS. A leitura utiliza a Web Speech API do navegador. O Supabase fornece autenticação e persistência em PostgreSQL, com controle de acesso por usuário no banco de dados.

## Organização do código

```text
src/
├── auth/          # Sessão, login e cadastro
├── components/    # Prancha, evolução e histórico
├── data/          # Vocabulário inicial
├── hooks/         # Síntese de voz e acesso aos dados
├── lib/           # Cliente Supabase e tipos
├── App.tsx        # Navegação e interface principal
└── styles.css     # Estilos globais
supabase/
├── migrations/    # Estrutura e regras do banco
└── tests/         # Verificação do isolamento de dados
```

## Requisitos

- Node.js 24.15 ou superior da linha 24 e npm.
- Navegador moderno; a leitura em voz alta depende do suporte à Web Speech API.
- Projeto Supabase configurado para autenticação e armazenamento dos dados.

## Configuração e execução

Instale as dependências com `npm ci`. Crie um arquivo `.env.local` com as variáveis indicadas em `.env.example`:

| Variável | Finalidade |
| --- | --- |
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública publishable da aplicação |

Configurações e credenciais específicas de cada ambiente não fazem parte do repositório. Aplique a migração disponível em `supabase/migrations/` no projeto de destino e configure os endereços de retorno da autenticação para o domínio da aplicação.

```shell
npm run dev
```

Sem configuração do Supabase, a interface pode ser acessada pelo modo de demonstração, sem persistência no banco.

## Validação e publicação

```shell
npm run check
npm run build
```

O primeiro comando executa a verificação de tipos, os testes automatizados e o build. O build gera o diretório `dist/`, que pode ser publicado em uma hospedagem estática. Os arquivos `vercel.json` e `netlify.toml` incluem a configuração de build para esses provedores. As variáveis de ambiente devem ser definidas no ambiente de build da hospedagem.
