# Comunica — CAA

Aplicativo Flutter para Android e iOS, desenvolvido a partir da proposta **Comunicação Aumentativa & Alternativa / Telessaúde Fonoaudiológica** enviada pelo usuário. Interface em português, com cores inspiradas na proposta. Projeto independente, sem atribuição de chancela institucional.

## O que está implementado

- Cadastro e login de responsáveis e fonoaudiólogos.
- Perfis individuais de crianças, criados pelo responsável. Nenhum diagnóstico é exigido.
- Prancha com 16 palavras iniciais, símbolos em emoji, categorias, busca e voz em português do Brasil.
- Vocabulário personalizado: adicionar, editar, arquivar e reativar palavras por criança.
- Seleções registradas automaticamente como uso da CAA.
- Registro manual das quatro etapas: CAA utilizada, tentativa de vocalização, palavra falada e domínio da palavra, com observação e autoria.
- Histórico paginado e preservação do nome usado no momento do registro.
- Gráfico diário, frequência por palavra, última avaliação e exportação CSV pela folha de compartilhamento do aparelho.
- Acompanhamento remoto: o responsável autoriza uma conta de fonoaudiólogo pelo e-mail e pode revogar o acesso.
- Modo criança com botões grandes; manter o cadeado pressionado volta à área adulta. É uma barreira contra toques acidentais, não um controle de autenticação.
- Sessão e fila de seleções pendentes no armazenamento seguro do aparelho. Reenvio usa o mesmo identificador para evitar duplicidade.

## Banco SQL e arquitetura

```text
Flutter Android / iOS
        │ HTTP em desenvolvimento / HTTPS na distribuição
        ▼
API Python / FastAPI
        │ consultas parametrizadas e transações
        ▼
SQLite — server/data/comunica.sqlite3
```

**SQLite é o banco SQL utilizado.** O arquivo fica no servidor, e não separado por celular: assim o responsável e a equipe consultam os mesmos registros. O esquema está em `server/schema.sql`, com as tabelas `users`, `sessions`, `children`, `members`, `words` e `events`. O banco é criado automaticamente na primeira execução. As senhas usam PBKDF2-SHA256 com salt e 600.000 iterações; apenas o hash do token é salvo no banco. Sessões expiram após sete dias.

Os registros confirmados sobrevivem ao fechamento do app e ao reinício da API. As seleções ainda não enviadas são mantidas no armazenamento seguro, associadas ao usuário e à criança; reabra o perfil e toque em **Enviar**. A prancha precisa carregar pela rede e não é uma implementação completa de operação offline. Observações manuais com erro de envio podem ser reenviadas no próprio diálogo; não há rascunho persistente para elas.

## Executar a API

Requisitos: Python 3.11 ou superior e Flutter 3.47.3 (versão usada no desenvolvimento).

No PowerShell, a partir da pasta deste projeto:

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

No macOS/Linux, os equivalentes são `python3 -m venv .venv` e `.venv/bin/python`.

A API deve continuar aberta enquanto o app for utilizado. A documentação interativa está em [API local](http://127.0.0.1:8000/docs). Não existe conta de demonstração predefinida: crie uma conta pelo aplicativo.

Para escolher outro arquivo de banco, defina `COMUNICA_DB` antes de iniciar a API. Faça backup do SQLite pela API `sqlite3.Connection.backup()` ou com o servidor parado; evite copiar apenas o arquivo principal enquanto o modo WAL estiver ativo.

## Executar no Android

Abra outro terminal na raiz do projeto:

```powershell
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:8000
```

`10.0.2.2` aponta para o computador a partir do emulador Android.

### Celular Android por USB e APK entregue

O APK de teste entregue separadamente usa `http://127.0.0.1:8000`. Com a API aberta e a depuração USB habilitada:

```powershell
adb reverse tcp:8000 tcp:8000
adb install -r ..\comunica-android-teste.apk
```

O redirecionamento USB precisa ser refeito se o aparelho for reconectado. Esse APK é **debug**, para validação; ele depende da API no computador. Para gerar o mesmo pacote:

```powershell
flutter build apk --debug --dart-define=API_URL=http://127.0.0.1:8000
```

Para testar pela rede local, inicie a API com `--host 0.0.0.0`, permita a porta apenas na rede privada e compile com `--dart-define=API_URL=http://IP_DO_COMPUTADOR:8000`. Use dados fictícios nessa configuração de desenvolvimento sem HTTPS.

## Executar no iOS

Os arquivos nativos iOS estão incluídos, com destino mínimo iOS 15. A compilação e assinatura precisam ser feitas em **macOS com Xcode**; não foi produzido um IPA neste ambiente Windows.

1. Disponibilize a API por um endereço HTTPS válido acessível pelo iPhone.
2. Execute `flutter pub get` no Mac.
3. Abra `ios/Runner.xcworkspace`, configure a equipe Apple e um identificador de aplicativo definitivo.
4. Execute `flutter run --dart-define=API_URL=https://SEU_DOMINIO` em um iPhone ou simulador.
5. Para distribuição: `flutter build ipa --dart-define=API_URL=https://SEU_DOMINIO`.

O Keychain usa `ios/Runner/Runner.entitlements`. Não foi desabilitada a proteção de transporte do iOS para permitir HTTP geral.

## Fluxo para conferir a proposta

1. Crie uma conta **Sou responsável**, entre e adicione uma criança.
2. Em **Comunicar**, toque em **Água**. O aparelho tenta reproduzir a palavra e a API registra uma seleção.
3. Abra **Evolução**: a contagem de usos aumenta. O sistema não conclui que a criança falou.
4. Toque em **Registrar evolução**, escolha a etapa observada e salve uma observação.
5. Consulte **Histórico** e exporte o relatório pelo ícone de compartilhamento em **Evolução**.
6. Em outro aparelho, crie uma conta **Sou fonoaudiólogo(a)**. O responsável autoriza esse e-mail em **Ajustes → Equipe**. Atualize a lista de perfis no aparelho do profissional.
7. Remova o profissional na área **Equipe** para bloquear novos acessos à API.

Os dados são atualizados ao abrir as abas, ao registrar uma ação ou ao tocar em atualizar; não há atualização em tempo real por WebSocket. Revogar acesso não apaga relatórios que já tenham sido exportados.

## Critérios dos relatórios

- “7 dias” e “30 dias” incluem o dia atual e os dias anteriores, usando datas UTC para gráfico e filtro.
- O horário individual no histórico é exibido no fuso do aparelho.
- Frequência conta **seleções na prancha**, não sucesso na reprodução sonora nem reconhecimento de fala.
- A última avaliação manual define a etapa, mesmo que seja inferior à anterior. Usos posteriores não apagam essa avaliação.
- Palavras dominadas consideram a última avaliação em todo o histórico, inclusive palavras arquivadas; a legenda deixa isso explícito.
- Arquivar uma palavra preserva os registros. Editar o texto não modifica os nomes já gravados no histórico.
- O relatório CSV possui UTF-8 com BOM, separador `;` e neutralização de fórmulas em campos de texto.

## Verificação

```powershell
flutter analyze
flutter test
cd server
python -m unittest -v test_api
```

Para o teste de integração, execute uma API com banco descartável, inicie um emulador Android e rode na raiz:

```powershell
flutter drive --driver=test_driver/integration.dart --target=integration_test/app_flow_test.dart -d emulator-5554
```

Esse teste cria contas e registros fictícios no servidor de teste. As capturas são gravadas em `screenshots/`.

## Antes de disponibilizar para usuários reais

Esta entrega é uma primeira versão funcional para validação, não uma publicação nas lojas. Falta escolher e hospedar a API em infraestrutura com HTTPS, configurar assinatura de produção Android/Apple e validar o uso em iPhones e aparelhos físicos com a equipe. O build de distribuição recusa endereços HTTP.

O servidor de referência usa SQLite em uma única instância com volume persistente. Não use réplicas com cópias independentes do arquivo. A operação pública também precisa de limites de acesso no proxy, política de backup, recuperação de conta, verificação de e-mail, gestão de exclusão de dados e definição dos responsáveis pelo tratamento das informações. O aviso no cadastro não substitui esses processos. Credenciais de produção e certificados não estão incluídos.

Voz e renderização dos emojis dependem do aparelho. Instale uma voz pt-BR no Android e confira o volume; não há reconhecimento de fala, gravação de áudio ou avaliação clínica automática. A seleção de vocabulário e a interpretação da evolução ficam com os responsáveis e profissionais.

## Referências de implementação

- [Flutter: publicação iOS](https://docs.flutter.dev/deployment/ios)
- [flutter_tts: voz e configuração Android](https://pub.dev/packages/flutter_tts)
- [flutter_secure_storage: armazenamento seguro](https://pub.dev/packages/flutter_secure_storage)
- [share_plus: exportação pelo aparelho](https://pub.dev/packages/share_plus)
- [FastAPI](https://fastapi.tiangolo.com/)
