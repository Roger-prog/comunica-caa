# Comunica — CAA

Comunica é um sistema web de Comunicação Aumentativa e Alternativa (CAA). A aplicação permite expressar necessidades, sentimentos e escolhas por meio de símbolos, composição de frases e leitura em voz alta.

## Desenvolvimento

O frontend usa React 19, TypeScript, Vite e Tailwind CSS 4. O Supabase fornece autenticação, banco e armazenamento. As funções em `api/` atendem fotos e pictogramas.

Com Node 24, execute `npm ci`. Para explorar dados de demonstração, use `npm run dev:demo`. Para o ambiente real, configure `.env.local` a partir de `.env.example` e execute `npm run dev`. Use `npm run check` para validar tipos, testes, políticas de acesso e build. Consulte [o guia de publicação](PUBLICAR_SITE.md) para configurar a Vercel.

## Prancha de comunicação

- Prancha visual com figuras ampliadas e respostas Sim/Não. As áreas Início, Essencial, Necessidades, Saúde, Favoritos, Meus símbolos e Frases rápidas ficam reunidas em “Categorias”.
- Controles principais “Ops”, “Próxima página” e “Categorias”, todos com pictograma e texto. “Ops” desfaz somente a última escolha, e trocar de área preserva a frase montada.
- Estilos da prancha isolados para preservar as fontes, a paleta e o modo escuro das demais telas. O alto contraste mantém os estados de seleção distinguíveis.
- 418 entradas reunindo o vocabulário de CAA, os símbolos originais e os grupos de apoio à teleconsulta.
- Tela inicial configurável, categorias ilustradas e comandos para voltar, desfazer a última escolha e oferecer uma dica.
- Busca que reconhece acentos, variantes de escrita e palavras relacionadas.
- Pictogramas oficiais do ARASAAC com indicação de origem e cartões com legenda quando a imagem aguarda revisão.
- Composição de frases com limite configurável de 8 a 80 símbolos por paciente. A prancha mantém a ordem e as repetições escolhidas.
- Frases rápidas opcionais e personalizáveis, com leitura direta ou adição ao compositor.
- Leitura de cada símbolo e da frase completa.
- Controles para remover um símbolo, desfazer a última adição, limpar a frase e interromper a reprodução.
- Resposta visual ao toque e identificação do último símbolo selecionado.

## Voz e reprodução

- Síntese neural no dispositivo com Faber e Edresson em português do Brasil, para símbolos do catálogo, símbolos personalizados e frases.
- Gravações incluídas de Francisca e Antônio para parte do vocabulário e para as frases rápidas padrão.
- Preferências de voz e velocidade por perfil.
- Reaproveitamento dos áudios gerados durante a sessão.
- Voz do dispositivo disponível por escolha do usuário.

## Perfis e acompanhamento

- Cadastro com escolha entre Responsável e Fonoaudiólogo.
- Acesso por e-mail e senha ou conta Google.
- Confirmação de e-mail e recuperação de senha por link.
- Conclusão do perfil no primeiro acesso pelo Google.
- Painéis e navegação de acordo com o tipo de conta.
- Perfis individuais de crianças vinculados ao usuário.
- Histórico por perfil, com pictogramas, pesquisa, filtro de período e filtros para seleções de símbolos e mensagens reproduzidas.
- Registro de símbolos do catálogo e símbolos personalizados. Mensagens completas são registradas quando a leitura começa.
- Controles para pausar novos registros e excluir o histórico inteiro ou registros anteriores ao período escolhido.
- Indicadores de uso em períodos de 7 ou 30 dias ou em um período personalizado.
- Gráfico diário de seleções e mensagens reproduzidas, com frequência por símbolo e categorias.

## Modo comunicação

- Prancha com a frase, os pictogramas e o cadeado de saída.
- Navegação e menus do responsável ocultos durante o uso.
- Saída protegida por PIN definido pelo responsável para a sessão.
- Ativação de tela cheia em navegadores compatíveis.

## Acompanhamento profissional

- Convites individuais com código de seis dígitos, uso único e validade de 10 minutos.
- Preparação de e-mail com o convite para revisão e envio pelo responsável.
- Painel do fonoaudiólogo com os pacientes vinculados e acesso de consulta ao histórico.
- Seleção de período, paginação dos registros e exportação de relatórios em PDF.
- Relatórios com identificação do paciente, indicadores de uso, tabela de comunicações e paginação.
- Consulta e remoção dos vínculos pelo responsável.
- Permissão separada para o profissional editar a prancha e visualizar suas fotos.

## Acessibilidade e personalização

- Interface responsiva para computador, tablet e celular.
- Cartões ampliados, rótulos textuais e navegação por teclado.
- Preferências de voz, velocidade, contraste, tamanho, espaçamento, colunas e paginação por paciente.
- Organização de categorias, favoritos, tela inicial e ordem dos símbolos.
- Criação, edição e ocultação de símbolos com legenda e fala próprias, pictogramas pesquisáveis e fotos privadas.
- Prévia, recorte e compressão das fotos antes de salvar.
- Demonstração interativa sem cadastro, com registros temporários durante a sessão.

## Acesso de demonstração

- Login simulado com um usuário fictício e campos de acesso opcionais.
- Sessão mantida ao atualizar a página na mesma aba do navegador.
- Navegação entre a prancha, evolução, histórico, ajustes e painel profissional.
- Saída da conta com encerramento da sessão de demonstração e retorno ao login.
- Perfis e comunicações de exemplo para explorar as funcionalidades.

## Relatórios e comunicação

O relatório PDF inclui o período, totais, gráficos de frequência e uma tabela paginada. Na Evolução, a gravação de pronúncia permite ouvir e descartar um trecho local. A tradução em Libras é opcional e disponibiliza somente a frase escolhida ao intérprete. A migração 009 habilita a categoria profissional e a exclusão da própria conta. Contas com fotos devem remover as imagens antes da exclusão.

A migração `009_account_preferences.sql` deve ser aplicada ao banco antes de disponibilizar as novas opções de conta no ambiente real. A integração dos arquivos e os testes locais não executam essa migração em produção. O carregamento do widget VLibras foi verificado; a tradução completa pelo avatar depende do serviço externo e ainda requer homologação.
