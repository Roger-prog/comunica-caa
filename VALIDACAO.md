# Verificação da entrega

Executada em 11/09/2026, com Flutter 3.47.3 / Dart 3.13.3, Windows e emulador Android.

| Verificação | Resultado |
| --- | --- |
| `flutter analyze` | Sem apontamentos |
| `flutter test` | 5 testes passaram |
| `python -m unittest -v test_api` | 7 testes passaram |
| Integração Flutter em emulador Android | Fluxo completo passou |
| Build APK debug | Compilação Android realizada |
| Build e execução iOS | Não executados: requer macOS/Xcode |

## Cobertura

API: autenticação, hash de senha, sessão encerrada, persistência no arquivo SQL, isolamento por conta, autorização/revogação do profissional, recusa de palavra de outra criança, validação de etapas, idempotência de reenvio, distinção entre seleção e domínio, preservação do histórico ao editar/arquivar, paginação, filtros por período e exportação CSV.

Flutter: validação e login, envio autenticado e tratamento de erros, seleção da prancha como uso, painel de avaliação manual, tela de entrada com texto ampliado e isolamento/persistência da fila pendente.

Integração real: a conta de teste entrou pelo formulário, carregou uma criança criada no servidor, selecionou Água, confirmou a contagem no SQL pela API, registrou Palavra falada, conferiu o histórico e adicionou Música ao vocabulário. As capturas em `screenshots/` vieram do aplicativo Flutter executado no emulador, com dados fictícios.

## Limites da verificação

Não houve teste em aparelho físico nem validação auditiva humana da voz. O TTS depende da voz pt-BR disponível no sistema; o fluxo de seleção foi testado separadamente do sucesso do áudio. A folha nativa de compartilhamento não foi acionada no teste automatizado; o conteúdo CSV foi testado na API. Não houve publicação em lojas, hospedagem externa, ensaio de carga ou avaliação clínica. O Dockerfile é uma opção de empacotamento fornecida, mas não foi construído neste ambiente.

O plugin `flutter_tts` emitiu aviso de migração futura do Kotlin Gradle Plugin; a compilação passou na versão de Flutter documentada. A dependência está fixada pelo `pubspec.lock`.
