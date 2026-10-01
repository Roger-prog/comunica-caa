import 'package:flutter/material.dart';

import 'api.dart';
import 'screens.dart';

class PasswordRecovery extends StatefulWidget {
  final Api api;
  final VoidCallback onDone;
  const PasswordRecovery({super.key, required this.api, required this.onDone});
  @override
  State<PasswordRecovery> createState() => _PasswordRecoveryState();
}

class _PasswordRecoveryState extends State<PasswordRecovery> {
  final password = TextEditingController(),
      confirmation = TextEditingController();
  final form = GlobalKey<FormState>();
  bool busy = false;
  @override
  void dispose() {
    password.dispose();
    confirmation.dispose();
    super.dispose();
  }

  Future<void> save() async {
    if (!form.currentState!.validate()) return;
    setState(() => busy = true);
    try {
      await widget.api.call('POST', '/auth/password', {
        'password': password.text,
      });
      await widget.api.forget();
      if (mounted) {
        message(context, 'Senha atualizada. Entre com a nova senha.');
        widget.onDone();
      }
    } catch (e) {
      if (mounted) message(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.all(28),
          children: [
            Text(
              'Escolha uma nova senha',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 24),
            Form(
              key: form,
              child: Column(
                children: [
                  TextFormField(
                    controller: password,
                    obscureText: true,
                    maxLength: 128,
                    decoration: const InputDecoration(labelText: 'Nova senha'),
                    validator: (v) =>
                        v!.length < 10 ? 'Use pelo menos 10 caracteres' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: confirmation,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Repita a senha',
                    ),
                    validator: (v) => v != password.text
                        ? 'As senhas precisam ser iguais'
                        : null,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: busy ? null : save,
              child: Text(busy ? 'Salvando…' : 'Salvar nova senha'),
            ),
            TextButton(
              onPressed: busy ? null : widget.onDone,
              child: const Text('Voltar ao início'),
            ),
          ],
        ),
      ),
    ),
  );
}
