import 'package:flutter/material.dart';

import 'api.dart';
import 'screens.dart';

Future<String?> textDialog(
  BuildContext context,
  String title,
  String label, {
  int maxLength = 254,
}) async {
  final controller = TextEditingController();
  final form = GlobalKey<FormState>();
  final result = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Form(
        key: form,
        child: TextFormField(
          controller: controller,
          autofocus: true,
          maxLength: maxLength,
          decoration: InputDecoration(labelText: label),
          validator: (v) => v!.trim().isEmpty ? 'Preencha este campo' : null,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () {
            if (form.currentState!.validate()) {
              Navigator.pop(context, controller.text.trim());
            }
          },
          child: const Text('Continuar'),
        ),
      ],
    ),
  );
  await Future<void>.delayed(const Duration(milliseconds: 300));
  controller.dispose();
  return result;
}

class WordDialog extends StatefulWidget {
  final Api api;
  final String path;
  final Map<String, dynamic>? word;
  const WordDialog({
    super.key,
    required this.api,
    required this.path,
    this.word,
  });
  @override
  State<WordDialog> createState() => _WordDialogState();
}

class _WordDialogState extends State<WordDialog> {
  final form = GlobalKey<FormState>();
  late final label = TextEditingController(text: widget.word?['label'] ?? '');
  late final category = TextEditingController(
    text: widget.word?['category'] ?? 'Necessidades',
  );
  late final symbol = TextEditingController(
    text: widget.word?['symbol'] ?? '💬',
  );
  late bool active = widget.word == null || widget.word!['active'] == 1;
  bool busy = false;
  @override
  void dispose() {
    label.dispose();
    category.dispose();
    symbol.dispose();
    super.dispose();
  }

  Future<void> save() async {
    if (!form.currentState!.validate()) return;
    setState(() => busy = true);
    try {
      await widget.api.call(
        widget.word == null ? 'POST' : 'PUT',
        '${widget.path}/words${widget.word == null ? '' : '/${widget.word!['id']}'}',
        {
          'label': label.text.trim(),
          'symbol': symbol.text.trim(),
          'category': category.text.trim(),
          'active': active,
        },
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) message(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.word == null ? 'Nova palavra' : 'Editar palavra'),
    content: SizedBox(
      width: 400,
      child: SingleChildScrollView(
        child: Form(
          key: form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: label,
                maxLength: 60,
                decoration: const InputDecoration(
                  labelText: 'Palavra ou expressão',
                ),
                validator: (v) =>
                    v!.trim().isEmpty ? 'Informe uma palavra' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: symbol,
                maxLength: 4,
                decoration: const InputDecoration(labelText: 'Símbolo (emoji)'),
                validator: (v) => v!.trim().isEmpty || v.runes.length > 12
                    ? 'Informe um símbolo curto'
                    : null,
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 4,
                children:
                    [
                          '💧',
                          '🍎',
                          '🚽',
                          '😊',
                          '😢',
                          '🧸',
                          '🏠',
                          '🙋',
                          '❤️',
                          '⚽',
                          '📚',
                          '💬',
                        ]
                        .map(
                          (e) => ActionChip(
                            label: Text(e),
                            onPressed: () => symbol.text = e,
                          ),
                        )
                        .toList(),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: category,
                maxLength: 40,
                decoration: const InputDecoration(labelText: 'Categoria'),
                validator: (v) =>
                    v!.trim().isEmpty ? 'Informe a categoria' : null,
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Mostrar na prancha'),
                value: active,
                onChanged: (v) => setState(() => active = v),
              ),
            ],
          ),
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: busy ? null : () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        onPressed: busy ? null : save,
        child: Text(busy ? 'Salvando…' : 'Salvar'),
      ),
    ],
  );
}

class EvolutionDialog extends StatefulWidget {
  final Api api;
  final String path;
  final Map<String, dynamic> word;
  const EvolutionDialog({
    super.key,
    required this.api,
    required this.path,
    required this.word,
  });
  @override
  State<EvolutionDialog> createState() => _EvolutionDialogState();
}

class _EvolutionDialogState extends State<EvolutionDialog> {
  int stage = 0;
  bool busy = false;
  final note = TextEditingController();
  Map<String, dynamic>? attempted;
  String? error;
  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  Future<void> save() async {
    setState(() {
      busy = true;
      error = null;
    });
    attempted ??= {
      'word_id': widget.word['id'],
      'kind': 'evolution',
      'stage': stage,
      'note': note.text.trim(),
      'request_id': requestId(),
    };
    try {
      await widget.api.call('POST', '${widget.path}/events', attempted);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text('${widget.word['symbol']} ${widget.word['label']}'),
    content: SizedBox(
      width: 400,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'O que você observou?',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text(
              'Registre a observação atual. Tocar no símbolo não significa que a criança falou ou dominou a palavra.',
              style: TextStyle(fontSize: 13, height: 1.5),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<int>(
              initialValue: stage,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Etapa observada'),
              items: List.generate(
                4,
                (i) => DropdownMenuItem(
                  value: i,
                  child: Text(stages[i], style: const TextStyle(fontSize: 13)),
                ),
              ),
              onChanged: attempted != null
                  ? null
                  : (v) => setState(() => stage = v!),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: note,
              enabled: attempted == null,
              maxLines: 3,
              maxLength: 1000,
              decoration: const InputDecoration(
                labelText: 'Observação (opcional)',
                hintText: 'Ex.: pediu água durante o lanche.',
              ),
            ),
            if (error != null)
              Text(
                '$error\nTente enviar novamente para confirmar o registro.',
                style: const TextStyle(color: Colors.red),
              ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: busy ? null : () => Navigator.pop(context),
        child: const Text('Fechar'),
      ),
      FilledButton(
        onPressed: busy ? null : save,
        child: Text(
          busy
              ? 'Salvando…'
              : attempted != null
              ? 'Tentar novamente'
              : 'Registrar',
        ),
      ),
    ],
  );
}

class TeamScreen extends StatefulWidget {
  final Api api;
  final String path;
  const TeamScreen({super.key, required this.api, required this.path});
  @override
  State<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends State<TeamScreen> {
  List<dynamic> members = [];
  String? error;
  bool busy = true;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final result = await widget.api.call('GET', '${widget.path}/members');
      if (mounted) {
        setState(() {
          members = result;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> add() async {
    final email = await textDialog(
      context,
      'Autorizar profissional',
      'E-mail da conta do profissional',
    );
    if (email == null) return;
    try {
      await widget.api.call('POST', '${widget.path}/members', {'email': email});
      await load();
    } catch (e) {
      if (mounted) message(context, e);
    }
  }

  Future<void> remove(Map<String, dynamic> member) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Remover acesso?'),
        content: Text(
          '${member['name']} deixará de consultar e registrar informações desta criança.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Remover'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.api.call('DELETE', '${widget.path}/members/${member['id']}');
      await load();
    } catch (e) {
      if (mounted) message(context, e);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Equipe')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          'Cuidar em conjunto.',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 12),
        const Text(
          'Autorize a conta de um fonoaudiólogo para consultar o histórico, personalizar palavras e registrar observações. Você pode remover o acesso a qualquer momento.',
          style: TextStyle(height: 1.6),
        ),
        const SizedBox(height: 24),
        if (busy) const Center(child: CircularProgressIndicator()),
        if (error != null) ...[
          Text(error!),
          TextButton(onPressed: load, child: const Text('Tentar novamente')),
        ],
        for (final m in members)
          Card(
            child: ListTile(
              title: Text(m['name']),
              subtitle: Text(m['email']),
              trailing: IconButton(
                tooltip: 'Remover acesso',
                icon: const Icon(Icons.person_remove_outlined),
                onPressed: () => remove(Map<String, dynamic>.from(m)),
              ),
            ),
          ),
        if (!busy && members.isEmpty && error == null)
          const Padding(
            padding: EdgeInsets.only(bottom: 24),
            child: Text('Nenhum profissional autorizado.'),
          ),
        FilledButton.icon(
          onPressed: add,
          icon: const Icon(Icons.person_add_outlined),
          label: const Text('Autorizar profissional'),
        ),
      ],
    ),
  );
}
