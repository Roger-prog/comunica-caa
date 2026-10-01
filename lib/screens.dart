import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:share_plus/share_plus.dart';

import 'api.dart';
import 'main.dart';
import 'dialogs.dart';
import 'browser_features.dart';
import 'supabase_api.dart';
import 'turnstile_controller.dart';
import 'turnstile_widget.dart';

void message(BuildContext context, Object text) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(text.toString()),
      behavior: SnackBarBehavior.floating,
    ),
  );
}

class AuthScreen extends StatefulWidget {
  final Api api;
  final ValueChanged<Map<String, dynamic>> onLogin;
  final TurnstileController? captchaController;
  const AuthScreen({
    super.key,
    required this.api,
    required this.onLogin,
    this.captchaController,
  });
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final form = GlobalKey<FormState>();
  final email = TextEditingController(),
      password = TextEditingController(),
      name = TextEditingController();
  bool register = false, busy = false, obscure = true, consent = false;
  String role = 'responsavel';
  TurnstileController? captcha;
  @override
  void initState() {
    super.initState();
    if (widget.api case SupabaseApi(turnstileSiteKey: final key)
        when key.isNotEmpty) {
      captcha = widget.captchaController ?? TurnstileController(key);
    }
  }

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    name.dispose();
    if (widget.captchaController == null) captcha?.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (busy) return;
    if (!form.currentState!.validate()) return;
    if (register && !consent) {
      message(
        context,
        'Confirme que compreendeu como os dados serão armazenados.',
      );
      return;
    }
    final captchaToken = captcha?.takeToken();
    if (captcha != null && captchaToken == null) {
      message(context, 'Conclua a verificação de segurança para continuar.');
      return;
    }
    setState(() => busy = true);
    try {
      final result = await widget.api.call(
        'POST',
        register ? '/auth/register' : '/auth/login',
        {
          'email': email.text.trim(),
          'password': password.text,
          'captchaToken': ?captchaToken,
          if (register) 'name': name.text.trim(),
          if (register) 'role': role,
        },
      );
      if (result['confirmation_required'] == true) {
        if (mounted) {
          setState(() => register = false);
          message(
            context,
            'Confira seu e-mail para confirmar o cadastro. Depois, entre com sua senha.',
          );
        }
        return;
      }
      await widget.api.remember(result['token']);
      if (mounted) widget.onLogin(Map<String, dynamic>.from(result['user']));
    } catch (e) {
      if (mounted) message(context, e);
    } finally {
      if (mounted) {
        captcha?.reset();
        setState(() => busy = false);
      }
    }
  }

  Future<void> recover() async {
    if (busy) return;
    // Keep the challenge on the screen instead of hiding it behind a dialog.
    if (captcha != null && !captcha!.ready) {
      message(context, 'Conclua a verificação de segurança para continuar.');
      return;
    }
    final address = await textDialog(
      context,
      'Recuperar acesso',
      'E-mail da sua conta',
    );
    if (address == null || !mounted) return;
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(address.trim())) {
      message(context, 'Informe um e-mail válido.');
      return;
    }
    final captchaToken = captcha?.takeToken();
    if (captcha != null && captchaToken == null) {
      message(context, 'A verificação expirou. Refaça a verificação.');
      return;
    }
    setState(() => busy = true);
    try {
      await widget.api.call('POST', '/auth/reset', {
        'email': address.trim(),
        'captchaToken': ?captchaToken,
      });
      if (mounted) {
        message(
          context,
          'Se houver uma conta para esse e-mail, você receberá as instruções de recuperação.',
        );
      }
    } catch (e) {
      if (mounted) message(context, e);
    } finally {
      if (mounted) {
        captcha?.reset();
        setState(() => busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(28),
            children: [
              const Align(
                alignment: Alignment.centerLeft,
                child: CircleAvatar(
                  radius: 32,
                  backgroundColor: Color(0xFFEDE3FA),
                  child: Icon(Icons.forum_rounded, size: 32, color: purple),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                'Comunica',
                style: Theme.of(context).textTheme.headlineLarge,
              ),
              const SizedBox(height: 8),
              const Text(
                'Cada expressão importa.',
                style: TextStyle(fontSize: 21, color: purple),
              ),
              const SizedBox(height: 8),
              const Text(
                'Comunicação, autonomia e descobertas.\nUm passo de cada vez.',
                style: TextStyle(fontSize: 16, height: 1.6),
              ),
              const SizedBox(height: 28),
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, label: Text('Entrar')),
                  ButtonSegment(value: true, label: Text('Criar conta')),
                ],
                selected: {register},
                onSelectionChanged: busy
                    ? null
                    : (s) => setState(() => register = s.first),
              ),
              const SizedBox(height: 24),
              Form(
                key: form,
                child: Column(
                  children: [
                    if (register) ...[
                      TextFormField(
                        controller: name,
                        decoration: const InputDecoration(
                          labelText: 'Seu nome',
                        ),
                        maxLength: 80,
                        validator: (v) =>
                            v!.trim().isEmpty ? 'Informe seu nome' : null,
                      ),
                      const SizedBox(height: 12),
                    ],
                    TextFormField(
                      controller: email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      decoration: const InputDecoration(
                        labelText: 'E-mail',
                        prefixIcon: Icon(Icons.alternate_email),
                      ),
                      validator: (v) =>
                          RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                              .hasMatch(v!.trim())
                          ? null
                          : 'Informe um e-mail válido',
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: password,
                      obscureText: obscure,
                      maxLength: 128,
                      decoration: InputDecoration(
                        labelText: 'Senha',
                        helperText: 'No mínimo 10 caracteres',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          tooltip: obscure ? 'Mostrar senha' : 'Ocultar senha',
                          onPressed: () => setState(() => obscure = !obscure),
                          icon: Icon(
                            obscure
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                          ),
                        ),
                      ),
                      validator: (v) => v!.length < 10
                          ? 'Use pelo menos 10 caracteres'
                          : null,
                    ),
                    if (register) ...[
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String>(
                        initialValue: role,
                        decoration: const InputDecoration(
                          labelText: 'Como você vai acompanhar?',
                        ),
                        items: const [
                          DropdownMenuItem(
                            value: 'responsavel',
                            child: Text('Sou responsável'),
                          ),
                          DropdownMenuItem(
                            value: 'fonoaudiologo',
                            child: Text('Sou fonoaudiólogo(a)'),
                          ),
                        ],
                        onChanged: (v) => setState(() => role = v!),
                      ),
                      const SizedBox(height: 12),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: consent,
                        onChanged: (v) => setState(() => consent = v!),
                        title: const Text(
                          'Entendo que os dados da conta e os registros de comunicação serão armazenados no servidor. O responsável decide quais profissionais têm acesso.',
                          style: TextStyle(fontSize: 13, height: 1.4),
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    if (captcha != null) ...[
                      TurnstileWidget(controller: captcha!),
                      const SizedBox(height: 8),
                      ListenableBuilder(
                        listenable: captcha!,
                        builder: (context, _) => Semantics(
                          liveRegion: true,
                          child: Text(
                            captcha!.status,
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontSize: 13, height: 1.4),
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: busy ? null : captcha!.reset,
                        child: const Text('Refazer verificação'),
                      ),
                      const SizedBox(height: 12),
                    ],
                    if (!register &&
                        widget.api is SupabaseApi &&
                        (widget.api as SupabaseApi).emailRecoveryEnabled)
                      TextButton(
                        onPressed: busy ? null : recover,
                        child: const Text('Esqueci minha senha'),
                      ),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: busy ? null : submit,
                        child: Text(
                          busy
                              ? 'Aguarde…'
                              : register
                              ? 'Criar minha conta'
                              : 'Entrar',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'COMUNICAÇÃO AUMENTATIVA E ALTERNATIVA',
                style: TextStyle(
                  fontSize: 10,
                  letterSpacing: 1.6,
                  color: purple,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class ChildrenScreen extends StatefulWidget {
  final Api api;
  final Map<String, dynamic> user;
  final Future<void> Function() logout;
  const ChildrenScreen({
    super.key,
    required this.api,
    required this.user,
    required this.logout,
  });
  @override
  State<ChildrenScreen> createState() => _ChildrenScreenState();
}

class _ChildrenScreenState extends State<ChildrenScreen> {
  List<dynamic> children = [];
  bool loading = true;
  String? error;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final result = await widget.api.call('GET', '/children');
      if (mounted) {
        setState(() {
          children = result;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> add() async {
    final name = await textDialog(
      context,
      'Novo perfil',
      'Nome ou apelido da criança',
      maxLength: 80,
    );
    if (name == null) return;
    try {
      await widget.api.call('POST', '/children', {'name': name});
      await load();
    } catch (e) {
      if (mounted) message(context, e);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Comunica'),
      actions: [
        IconButton(
          tooltip: 'Sair da conta',
          onPressed: () async {
            try {
              await widget.logout();
            } catch (e) {
              if (context.mounted) message(context, e);
            }
          },
          icon: const Icon(Icons.logout),
        ),
      ],
    ),
    body: RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text(
            'VAMOS NOS COMUNICAR',
            style: TextStyle(
              color: purple,
              letterSpacing: 1.5,
              fontWeight: FontWeight.w700,
              fontSize: 11,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Olá, ${widget.user['name']}.',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 8),
          const Text(
            'Escolha quem você vai acompanhar hoje.',
            style: TextStyle(fontSize: 16, height: 1.5),
          ),
          const SizedBox(height: 28),
          if (loading) const Center(child: CircularProgressIndicator()),
          if (error != null) ...[
            Text(error!),
            TextButton(onPressed: load, child: const Text('Tentar novamente')),
          ],
          for (final child in children)
            Card(
              child: ListTile(
                contentPadding: const EdgeInsets.all(20),
                leading: CircleAvatar(
                  backgroundColor: const Color(0xFFEDE3FA),
                  child: Text(
                    (child['name'] as String).characters.first.toUpperCase(),
                  ),
                ),
                title: Text(
                  child['name'],
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 20,
                  ),
                ),
                subtitle: Text(
                  child['owner_id'] == widget.user['id']
                      ? 'Prancha e acompanhamento'
                      : 'Acompanhamento compartilhado',
                ),
                trailing: const Icon(
                  Icons.arrow_forward_rounded,
                  color: purple,
                ),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ChildScreen(
                      api: widget.api,
                      user: widget.user,
                      child: Map<String, dynamic>.from(child),
                    ),
                  ),
                ),
              ),
            ),
          if (!loading && children.isEmpty && error == null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    const Icon(
                      Icons.diversity_1_outlined,
                      size: 52,
                      color: purple,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      widget.user['role'] == 'responsavel'
                          ? 'O primeiro passo começa aqui. Crie um perfil para abrir a prancha de comunicação.'
                          : 'Seus acompanhamentos aparecerão aqui quando um responsável autorizar seu e-mail na área Equipe.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(height: 1.6),
                    ),
                    if (widget.user['role'] == 'fonoaudiologo') ...[
                      const SizedBox(height: 12),
                      SelectableText(widget.user['email']),
                    ],
                  ],
                ),
              ),
            ),
          if (widget.user['role'] == 'responsavel')
            OutlinedButton.icon(
              onPressed: add,
              icon: const Icon(Icons.add),
              label: const Text('Adicionar criança'),
            ),
        ],
      ),
    ),
  );
}

class ChildScreen extends StatefulWidget {
  final Api api;
  final Map<String, dynamic> user, child;
  const ChildScreen({
    super.key,
    required this.api,
    required this.user,
    required this.child,
  });
  @override
  State<ChildScreen> createState() => _ChildScreenState();
}

class _ChildScreenState extends State<ChildScreen> {
  final tts = FlutterTts();
  List<dynamic> words = [], history = [];
  Map<String, dynamic>? report;
  List<Map<String, dynamic>> pending = [];
  int tab = 0, days = 7;
  String category = 'Todos',
      search = '',
      lastWord = '',
      status = 'Toque em um símbolo para falar';
  bool loading = true,
      childMode = false,
      syncing = false,
      audioReady = false,
      moreHistory = true,
      paging = false;
  String? error;
  String get path => '/children/${widget.child['id']}';
  String get queueScope => '${widget.user['id']}_${widget.child['id']}';
  @override
  void initState() {
    super.initState();
    initialize();
    setupVoice();
    registerVocabularySearch((value) {
      if (mounted) {
        setState(() {
          search = value;
          category = 'Todos';
          tab = 0;
        });
      }
    });
  }

  Future<void> initialize() async {
    try {
      pending = await widget.api.readPending(queueScope);
      await load();
      if (mounted && pending.isNotEmpty) await flush();
    } catch (_) {
      if (mounted) {
        setState(() {
          loading = false;
          error = 'Não foi possível recuperar os registros locais. Reinicie o aplicativo.';
        });
      }
    }
  }

  Future<void> setupVoice() async {
    if (kIsWeb) {
      audioReady = true;
      return;
    }
    try {
      final available = await tts.isLanguageAvailable('pt-BR');
      if (available != true && available != 1) {
        throw Exception('Voz indisponível');
      }
      await tts.setLanguage('pt-BR');
      await tts.setSpeechRate(0.42);
      await tts.awaitSpeakCompletion(true);
      tts.setErrorHandler((_) {
        if (mounted) {
          setState(() => status = 'Não foi possível reproduzir a voz');
        }
      });
      audioReady = true;
    } catch (_) {
      if (mounted) {
        setState(
          () => status = 'Instale uma voz em português nos ajustes do aparelho',
        );
      }
    }
  }

  @override
  void dispose() {
    unregisterVocabularySearch();
    tts.stop();
    super.dispose();
  }

  Future<void> load() async {
    final selectedDays = days;
    try {
      final results = await Future.wait([
        widget.api.call('GET', '$path/words'),
        widget.api.call('GET', '$path/report?days=$selectedDays'),
        widget.api.call('GET', '$path/events'),
      ]);
      if (mounted && days == selectedDays) {
        setState(() {
          words = results[0];
          report = Map<String, dynamic>.from(results[1]);
          history = results[2];
          moreHistory = history.length == 50;
          error = null;
          if (!words.any(
            (w) => w['category'] == category && w['active'] == 1,
          )) {
            category = 'Todos';
          }
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> more() async {
    if (paging || history.isEmpty) return;
    setState(() => paging = true);
    try {
      final List<dynamic> result = await widget.api.call(
        'GET',
        '$path/events?before=${history.last['id']}',
      );
      if (mounted) {
        setState(() {
          final ids = history.map((e) => e['id']).toSet();
          history.addAll(result.where((e) => !ids.contains(e['id'])));
          moreHistory = result.length == 50;
        });
      }
    } catch (e) {
      if (mounted) message(context, e);
    } finally {
      if (mounted) setState(() => paging = false);
    }
  }

  Future<void> speak(Map<String, dynamic> word) async {
    if (kIsWeb) {
      final started = speakBrowser(word['label'], () {
        if (mounted) {
          message(
            context,
            'Não foi possível reproduzir a voz. Confira o volume e a disponibilidade de uma voz em português.',
          );
        }
      });
      if (!started) {
        message(
          context,
          'Este navegador não disponibilizou a reprodução de voz.',
        );
      }
    }
    HapticFeedback.selectionClick();
    setState(() {
      lastWord = word['label'];
      status = 'Registrando uso…';
    });
    final event = <String, dynamic>{
      'word_id': word['id'],
      'kind': 'use',
      'stage': 0,
      'request_id': '${DateTime.now().microsecondsSinceEpoch}-${requestId()}',
    };
    try {
      await widget.api.savePending(queueScope, event);
      pending.add(event);
      if (mounted) flush();
    } catch (_) {
      if (mounted) {
        message(
          context,
          'Não foi possível salvar esta seleção no aparelho. Tente novamente.',
        );
      }
    }
    if (kIsWeb) return;
    try {
      if (!audioReady) throw Exception('Voz não disponível');
      await tts.stop();
      final result = await tts.speak(word['label']);
      if (result != 1) throw Exception('Voz não disponível');
    } catch (_) {
      if (mounted) {
        message(
          context,
          'A palavra foi selecionada, mas a voz não está disponível. Confira o volume e a voz em português.',
        );
      }
    }
  }

  Future<void> flush() async {
    if (syncing) return;
    setState(() => syncing = true);
    try {
      while (pending.isNotEmpty) {
        await widget.api.call('POST', '$path/events', pending.first);
        await widget.api.removePending(queueScope, pending.first);
        pending.removeAt(0);
      }
      if (mounted) setState(() => status = 'Uso registrado no histórico');
      // Refresh after releasing the sender, so rapid taps cannot strand a queue.
    } catch (_) {
      if (mounted) setState(() => status = 'Há registros aguardando envio');
    } finally {
      if (mounted) setState(() => syncing = false);
    }
    if (mounted) await load();
  }

  Future<void> wordDialog([Map<String, dynamic>? word]) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => WordDialog(api: widget.api, path: path, word: word),
    );
    if (changed == true) await load();
  }

  Future<void> evolution(Map<String, dynamic> word) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => EvolutionDialog(api: widget.api, path: path, word: word),
    );
    if (saved == true) await load();
  }

  Future<void> export() async {
    try {
      final String csv = await widget.api.call(
        'GET',
        '$path/report.csv?days=$days',
        null,
        true,
      );
      if (downloadCsv(csv)) return;
      if (!mounted) return;
      final box = context.findRenderObject() as RenderBox?;
      await SharePlus.instance.share(
        ShareParams(
          files: [
            XFile.fromData(
              Uint8List.fromList(utf8.encode(csv)),
              mimeType: 'text/csv',
            ),
          ],
          fileNameOverrides: ['evolucao.csv'],
          title: 'Relatório de evolução',
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    } catch (e) {
      if (mounted) message(context, e);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !childMode,
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop) {
        message(
          context,
          childMode
              ? 'Mantenha o cadeado pressionado para sair do modo criança.'
              : 'Envie os registros pendentes antes de sair.',
        );
      }
    },
    child: Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: !childMode,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.child['name']),
            const Text(
              'Cada expressão é uma conquista',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.normal),
            ),
          ],
        ),
        actions: [
          if (childMode)
            Semantics(
              label: 'Sair do modo criança. Mantenha pressionado.',
              button: true,
              child: GestureDetector(
                onLongPress: () => setState(() => childMode = false),
                child: const Padding(
                  padding: EdgeInsets.all(20),
                  child: Icon(Icons.lock_outline),
                ),
              ),
            ),
          if (!childMode)
            IconButton(
              tooltip: 'Modo criança',
              onPressed: () => setState(() {
                childMode = true;
                tab = 0;
                search = '';
                category = 'Todos';
              }),
              icon: const Icon(Icons.child_care),
            ),
          if (!childMode)
            IconButton(
              tooltip: 'Atualizar dados',
              onPressed: load,
              icon: const Icon(Icons.refresh),
            ),
        ],
      ),
      bottomNavigationBar: childMode
          ? null
          : NavigationBar(
              selectedIndex: tab,
              onDestinationSelected: (v) {
                setState(() => tab = v);
                if (v != 0) load();
              },
              destinations: const [
                NavigationDestination(
                  icon: Icon(Icons.grid_view_rounded),
                  label: 'Comunicar',
                ),
                NavigationDestination(
                  icon: Icon(Icons.insights_rounded),
                  label: 'Evolução',
                ),
                NavigationDestination(
                  icon: Icon(Icons.history_rounded),
                  label: 'Histórico',
                ),
                NavigationDestination(
                  icon: Icon(Icons.tune_rounded),
                  label: 'Ajustes',
                ),
              ],
            ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                if (error != null)
                  MaterialBanner(
                    content: Text(error!),
                    actions: [
                      TextButton(
                        onPressed: load,
                        child: const Text('Tentar novamente'),
                      ),
                    ],
                  ),
                if (pending.isNotEmpty)
                  Container(
                    color: const Color(0xFFFFE6C9),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${pending.length} registro(s) salvos no aparelho, aguardando envio.',
                          ),
                        ),
                        TextButton(
                          onPressed: syncing ? null : flush,
                          child: const Text('Enviar'),
                        ),
                      ],
                    ),
                  ),
                Expanded(
                  child: switch (tab) {
                    0 => board(),
                    1 => dashboard(),
                    2 => timeline(),
                    _ => settings(),
                  },
                ),
              ],
            ),
    ),
  );
  Widget board() {
    final active = words.where((w) => w['active'] == 1).toList();
    final categories = [
      'Todos',
      ...active.map((w) => w['category'] as String).toSet(),
    ];
    final filtered = active
        .where(
          (w) =>
              (category == 'Todos' || w['category'] == category) &&
              (w['label'] as String).toLowerCase().contains(
                search.toLowerCase(),
              ),
        )
        .toList();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: const Color(0xFFEEE5F8),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.record_voice_over_rounded,
                  color: purple,
                  size: 32,
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        lastWord.isEmpty ? 'O que você quer dizer?' : lastWord,
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          color: ink,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        status,
                        style: const TextStyle(fontSize: 12, color: purple),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        if (!childMode)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
            child: TextField(
              decoration: const InputDecoration(
                hintText: 'Encontrar uma palavra',
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
              onChanged: (v) => setState(() => search = v),
            ),
          ),
        SizedBox(
          height: 62,
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            scrollDirection: Axis.horizontal,
            itemCount: categories.length,
            separatorBuilder: (_, index) => const SizedBox(width: 8),
            itemBuilder: (_, i) => Center(
              child: ChoiceChip(
                label: Text(categories[i]),
                selected: category == categories[i],
                onSelected: (_) => setState(() => category = categories[i]),
              ),
            ),
          ),
        ),
        Expanded(
          child: filtered.isEmpty
              ? const Center(child: Text('Nenhuma palavra nesta seleção.'))
              : LayoutBuilder(
                  builder: (context, constraints) {
                    final columns = constraints.maxWidth > 700
                        ? 4
                        : constraints.maxWidth > 480
                        ? 3
                        : 2;
                    final scale = MediaQuery.textScalerOf(context).scale(1);
                    return GridView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: columns,
                        mainAxisExtent: 154 + (scale - 1).clamp(0, 3) * 75,
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                      ),
                      itemCount: filtered.length,
                      itemBuilder: (context, index) {
                        final w = Map<String, dynamic>.from(filtered[index]);
                        final color = switch (w['category']) {
                          'Necessidades' => const Color(0xFFE2F2F9),
                          'Sentimentos' => const Color(0xFFFFEBD8),
                          'Atividades' => const Color(0xFFE5F1E6),
                          _ => const Color(0xFFEFE5F8),
                        };
                        return Semantics(
                          label: 'Falar ${w['label']}',
                          button: true,
                          excludeSemantics: true,
                          child: Material(
                            color: color,
                            borderRadius: BorderRadius.circular(24),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(24),
                              onTap: () => speak(w),
                              child: Padding(
                                padding: const EdgeInsets.all(10),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text(
                                      w['symbol'],
                                      style: const TextStyle(fontSize: 43),
                                    ),
                                    const SizedBox(height: 8),
                                    Flexible(
                                      child: Text(
                                        w['label'],
                                        textAlign: TextAlign.center,
                                        style: const TextStyle(
                                          fontSize: 20,
                                          fontWeight: FontWeight.w700,
                                          color: ink,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget dashboard() {
    if (report == null) {
      return const Center(child: Text('Atualize para carregar a evolução.'));
    }
    final List<dynamic> reportWords = report!['words'];
    final int maximum = reportWords.fold<int>(
      1,
      (m, w) => w['uses'] > m ? w['uses'] as int : m,
    );
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Pequenas conquistas,\ngrandes possibilidades.',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: SegmentedButton<int>(
                  segments: const [
                    ButtonSegment(value: 7, label: Text('7 dias')),
                    ButtonSegment(value: 30, label: Text('30 dias')),
                  ],
                  selected: {days},
                  onSelectionChanged: (v) {
                    setState(() => days = v.first);
                    load();
                  },
                ),
              ),
              IconButton(
                tooltip: 'Baixar relatório CSV',
                onPressed: export,
                icon: const Icon(Icons.ios_share),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              metric(
                '${report!['total_uses']}',
                'Usos no período',
                Icons.touch_app_outlined,
              ),
              metric(
                '${report!['mastered']}',
                'Palavras dominadas¹',
                Icons.auto_awesome_outlined,
              ),
            ],
          ),
          const SizedBox(height: 20),
          const Text(
            'Frequência de comunicação',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          const Text(
            'Seleções na prancha por dia • datas em UTC',
            style: TextStyle(fontSize: 12),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: DailyChart(
                daily: List<dynamic>.from(report!['daily']),
                days: days,
              ),
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Palavras e evolução',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          const Text(
            '¹ Última avaliação registrada, considerando todo o histórico. O domínio é informado pelo adulto.',
            style: TextStyle(fontSize: 12, height: 1.5),
          ),
          const SizedBox(height: 16),
          for (final w in reportWords)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(w['symbol'], style: const TextStyle(fontSize: 28)),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            w['label'],
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        Text('${w['uses']} usos'),
                      ],
                    ),
                    const SizedBox(height: 12),
                    LinearProgressIndicator(
                      value: w['uses'] / maximum,
                      borderRadius: BorderRadius.circular(6),
                      minHeight: 6,
                      backgroundColor: const Color(0xFFF0EBF5),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      w['stage'] == null
                          ? 'Ainda sem avaliação'
                          : stages[w['stage']],
                      style: const TextStyle(color: purple),
                    ),
                    if (w['active'] == 1)
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                          onPressed: () =>
                              evolution(Map<String, dynamic>.from(w)),
                          icon: const Icon(Icons.add_circle_outline, size: 18),
                          label: const Text('Registrar evolução'),
                        ),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget metric(String value, String label, IconData icon) => Container(
    width: 160,
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      border: Border.all(color: const Color(0xFFEAE4F1)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: purple),
        const SizedBox(height: 12),
        Text(
          value,
          style: const TextStyle(
            fontSize: 32,
            color: ink,
            fontWeight: FontWeight.w800,
          ),
        ),
        Text(label, style: const TextStyle(fontSize: 12)),
      ],
    ),
  );
  Widget timeline() => RefreshIndicator(
    onRefresh: load,
    child: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          'Uma história de\ndescobertas.',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 8),
        const Text('Interações e observações, na ordem em que aconteceram.'),
        const SizedBox(height: 24),
        if (history.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                'O histórico começa com a primeira seleção na prancha.',
              ),
            ),
          ),
        for (final e in history)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CircleAvatar(
                    backgroundColor: e['kind'] == 'use'
                        ? const Color(0xFFEDE3FA)
                        : const Color(0xFFFFEBD8),
                    child: Icon(
                      e['kind'] == 'use' ? Icons.touch_app : Icons.auto_awesome,
                      color: purple,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          e['word_label'],
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 18,
                          ),
                        ),
                        Text(
                          e['kind'] == 'use'
                              ? 'CAA utilizada • seleção na prancha'
                              : stages[e['stage']],
                          style: const TextStyle(color: purple),
                        ),
                        if ((e['note'] as String).isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            child: Text(e['note']),
                          ),
                        const SizedBox(height: 8),
                        Text(
                          '${formatDate(e['created_at'])}\nRegistrado por ${e['author']}',
                          style: const TextStyle(fontSize: 12, height: 1.5),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (moreHistory)
          OutlinedButton(
            onPressed: paging ? null : more,
            child: Text(paging ? 'Carregando…' : 'Carregar anteriores'),
          ),
      ],
    ),
  );
  Widget settings() => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      Text('Do seu jeito.', style: Theme.of(context).textTheme.headlineMedium),
      const SizedBox(height: 8),
      const Text('Adapte o vocabulário à rotina e às escolhas da criança.'),
      const SizedBox(height: 24),
      if (widget.child['owner_id'] == widget.user['id'])
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const Icon(Icons.group_outlined, color: purple),
            title: const Text('Equipe de acompanhamento'),
            subtitle: const Text('Autorizar ou remover profissionais'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => TeamScreen(api: widget.api, path: path),
              ),
            ),
          ),
        ),
      FilledButton.icon(
        onPressed: () => wordDialog(),
        icon: const Icon(Icons.add),
        label: const Text('Adicionar palavra'),
      ),
      const SizedBox(height: 20),
      for (final w in words)
        Card(
          child: ListTile(
            leading: Text(w['symbol'], style: const TextStyle(fontSize: 30)),
            title: Text(w['label']),
            subtitle: Text(
              '${w['category']} • ${w['active'] == 1 ? 'Na prancha' : 'Arquivada'}',
            ),
            trailing: const Icon(Icons.edit_outlined),
            onTap: () => wordDialog(Map<String, dynamic>.from(w)),
          ),
        ),
      const SizedBox(height: 8),
      const Text(
        'Arquivar retira a palavra da prancha e preserva seu histórico. Os símbolos são emojis e podem variar entre aparelhos.',
        style: TextStyle(fontSize: 12, height: 1.5),
      ),
      const SizedBox(height: 20),
      const Text(
        'Sobre os registros',
        style: TextStyle(fontWeight: FontWeight.bold),
      ),
      const SizedBox(height: 8),
      const Text(
        'As informações ficam no servidor da equipe. É necessária conexão para salvar e consultar. Não há gravação de áudio nem identificação automática de fala. No modo criança, mantenha o cadeado pressionado para voltar.',
        style: TextStyle(height: 1.6),
      ),
    ],
  );
}

class DailyChart extends StatelessWidget {
  final List<dynamic> daily;
  final int days;
  const DailyChart({super.key, required this.daily, required this.days});
  @override
  Widget build(BuildContext context) {
    final counts = {for (final d in daily) d['day']: d['count'] as int};
    final today = DateTime.now().toUtc();
    final dates = List.generate(
      days,
      (i) => DateTime.utc(
        today.year,
        today.month,
        today.day,
      ).subtract(Duration(days: days - 1 - i)),
    );
    final max = counts.values.fold<int>(1, (m, v) => v > m ? v : m);
    return SizedBox(
      height: 120 + MediaQuery.textScalerOf(context).scale(40),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: dates.map((d) {
          final key = d.toIso8601String().substring(0, 10),
              n = counts[d.toIso8601String().substring(0, 10)] ?? 0;
          return Expanded(
            child: Tooltip(
              message: '$key: $n usos',
              child: Semantics(
                label: '$key, $n usos',
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      if (days == 7)
                        Text('$n', style: const TextStyle(fontSize: 11)),
                      const SizedBox(height: 4),
                      Container(
                        height: n == 0 ? 3 : 94 * n / max,
                        decoration: BoxDecoration(
                          color: n == 0 ? const Color(0xFFEAE4F1) : purple,
                          borderRadius: BorderRadius.circular(5),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        days == 7 || d == dates.first || d == dates.last
                            ? '${d.day}'
                            : '',
                        style: const TextStyle(fontSize: 10),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}
