import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api.dart';
import 'main.dart';
import 'supabase_api.dart';

bool validPublicKey(String key) {
  if (key.startsWith('sb_publishable_')) return true;
  try {
    return jsonDecode(
          utf8.decode(base64Url.decode(base64Url.normalize(key.split('.')[1]))),
        )['role'] ==
        'anon';
  } catch (_) {
    return false;
  }
}

Future<Api> configuredApi() async {
  if (const bool.fromEnvironment('USE_LOCAL_API')) return Api();
  var url = const String.fromEnvironment('SUPABASE_URL');
  var key = const String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY');
  var turnstileSiteKey = const String.fromEnvironment('TURNSTILE_SITE_KEY');
  var emailRecoveryEnabled = const bool.fromEnvironment(
    'ENABLE_PASSWORD_RECOVERY',
  );
  if (kIsWeb && (url.isEmpty || key.isEmpty)) {
    final response = await http
        .get(Uri.base.resolve('/config.json'))
        .timeout(const Duration(seconds: 10));
    if (response.statusCode != 200) throw Exception('Configuração ausente');
    final config = jsonDecode(response.body);
    url = config['supabaseUrl'] ?? '';
    key = config['supabasePublishableKey'] ?? '';
    turnstileSiteKey = config['turnstileSiteKey'] ?? '';
    emailRecoveryEnabled = config['emailRecoveryEnabled'] == true;
  }
  final uri = Uri.tryParse(url);
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host.isEmpty ||
      !validPublicKey(key)) {
    throw Exception('Configuração incompleta');
  }
  await Supabase.initialize(url: url, publishableKey: key, debug: false);
  return SupabaseApi(
    Supabase.instance.client,
    emailRecoveryEnabled: emailRecoveryEnabled,
    turnstileSiteKey: turnstileSiteKey.trim(),
  );
}

class SetupApp extends StatelessWidget {
  const SetupApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Comunica',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(colorSchemeSeed: purple),
    home: Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: const Padding(
            padding: EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.forum_rounded, size: 64, color: purple),
                SizedBox(height: 24),
                Text(
                  'Comunica',
                  style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 16),
                Text('Site em preparação', style: TextStyle(fontSize: 22)),
                SizedBox(height: 12),
                Text(
                  'A conexão com o banco de dados ainda não está disponível. Se você está configurando o projeto, siga o guia PUBLICAR_SITE.md. Se o site já estava funcionando, verifique a conexão e tente recarregar a página.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 16, height: 1.6),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
