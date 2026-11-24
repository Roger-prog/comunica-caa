# Comunica — CAA

Comunica é um sistema web de Comunicação Aumentativa e Alternativa (CAA). A aplicação permite expressar necessidades, sentimentos e escolhas por meio de símbolos, composição de frases e leitura em voz alta.

## Desenvolvimento

O frontend usa React 19, TypeScript, Vite e Tailwind CSS 4. O Supabase fornece autenticação, banco e armazenamento. As funções em `api/` atendem fotos e pictogramas.

Com Node 24, execute `npm ci`. Para explorar dados de demonstração, use `npm run dev:demo`. Para o ambiente real, configure `.env.local` a partir de `.env.example` e execute `npm run dev`. Use `npm run check` para validar tipos, testes, políticas de acesso e build. Consulte [o guia de publicação](PUBLICAR_SITE.md) para configurar a Vercel.

## Prancha de comunicação

- Prancha visual com figuras ampliadas e respostas Sim/Não. As áreas Início, Essencial, Necessidades, Saúde, Favoritos, Meus símbolos e Frases rápidas ficam reunidas em “Categorias”.
- Controles principais com desenhos grandes e coloridos: rostinho surpreso em “Ops”, folha com seta em “Próxima página” e pasta com cartões em “Categorias”. Os desenhos estão incluídos na aplicação, e o texto serve de apoio. “Ops” desfaz somente a última escolha, e trocar de área preserva a frase montada.
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

- Cadastro como responsável ou profissional com indicação da área de atuação.
- Acesso por e-mail e senha ou conta Google.
- Confirmação de e-mail e recuperação de senha por link.
- Conclusão do perfil no primeiro acesso pelo Google.
- Painéis e navegação de acordo com o tipo de conta.
- Perfis individuais de crianças com acesso de corresponsáveis por convite, com permissões de edição e de gestão definidas separadamente.
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
- Painel do profissional com os pacientes vinculados após aprovação do responsável e acesso de consulta ao histórico.
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

O relatório PDF inclui o período, totais, gráficos de frequência e uma tabela paginada. A consulta do histórico é paginada no banco e usa datas de calendário no fuso de São Paulo. Na Evolução, o paciente pode gravar, ouvir e salvar um trecho com autorização. O responsável principal define a retenção e quais profissionais vinculados podem ouvir e anotar as gravações. As observações são feitas pelo profissional.

O VLibras é opcional e roda em uma área isolada que contém apenas o guia público da prancha. A tradução depende do serviço externo. Atendimentos que exigem interpretação clínica devem contar com intérprete profissional.

## Migrações e operação

Em um banco atualizado até a migração 009, aplique as migrações 010 a 014 em ordem antes de publicar o frontend. Valide-as primeiro em um ambiente de teste com dados fictícios.

- **010 e 011** habilitam papéis de conta, aprovação de vínculos profissionais e corresponsáveis. O convite de corresponsável vale uma hora, serve para um único uso e exige a conta com o e-mail confirmado indicado pelo responsável. Os pedidos de habilitação profissional ficam em `comunica_react_private.professional_requests`. Depois de verificar a documentação pelos procedimentos do serviço, um operador com acesso SQL privilegiado usa `public.review_caa_professional_role(uuid, boolean)` para aprovar ou recusar o pedido.
- **012 e 013** adicionam áudio privado e consultas de histórico. A retenção padrão do áudio é de 90 dias. Reduzir o prazo também antecipa a expiração das gravações existentes. A migração 012 configura a rotina de limpeza quando `pg_cron` está disponível. Confira o agendamento no banco de homologação. A expiração bloqueia o acesso ao áudio mesmo entre execuções da limpeza.
- **014** exige login recente e confirmação explícita para exclusão de conta. Se houver outro responsável habilitado a assumir um paciente compartilhado, a tela informa quem receberá a responsabilidade antes da exclusão. Casos sem sucessor ou com objetos do Storage em nome da conta entram na fila restrita `comunica_react_private.account_deletion_reviews`. A equipe de privacidade deve revisar a destinação dos dados e dos arquivos, conforme as autorizações e a política de retenção do serviço. Use a API de Storage para transferir ou excluir arquivos. Configure `VITE_CONTACT_NAME` e `VITE_CONTACT_EMAIL` com o canal responsável pelo atendimento.
