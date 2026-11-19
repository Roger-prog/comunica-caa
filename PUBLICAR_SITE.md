# Publicar o Comunica na Vercel

1. Use Node 24 e instale as dependências com `npm ci`.
2. Configure um projeto Supabase e aplique as migrações de `supabase/migrations` em ordem. Nas configurações de autenticação, cadastre a URL pública e a URL de retorno `/auth/callback`.
3. Importe o repositório na Vercel com o preset Vite, comando `npm run build` e saída `dist`. As funções da pasta `api/` são executadas no servidor.
4. Copie os nomes de variáveis de `.env.example` para o ambiente de publicação. Use a URL e uma chave pública do Supabase no frontend. A credencial para a API de fotos pertence exclusivamente ao servidor. Informe o contato público da equipe.
5. Rode `npm run check` antes da publicação. No preview HTTPS, verifique login, retorno de e-mail, foto com câmera, reprodução de voz, convites e exportação de PDF usando perfis de teste.
