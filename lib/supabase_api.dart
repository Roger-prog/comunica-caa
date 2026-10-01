import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';

import 'api.dart';

/// Adapter preserves the existing UI contract; production never calls Python.
class SupabaseApi extends Api {
  final SupabaseClient supabase;
  final bool emailRecoveryEnabled;
  final String turnstileSiteKey;
  SupabaseApi(
    this.supabase, {
    this.emailRecoveryEnabled = false,
    this.turnstileSiteKey = '',
  });
  bool get recovery => Uri.base.queryParameters['recovery'] == '1';
  String? get _webOrigin =>
      Uri.base.scheme == 'https' || Uri.base.scheme == 'http'
      ? Uri.base.origin
      : null;
  @override
  Future<void> restore() async {
    token = supabase.auth.currentSession?.accessToken;
  }

  @override
  Future<void> remember(String value) async {
    token = supabase.auth.currentSession?.accessToken;
  }

  @override
  Future<void> forget() async {
    await supabase.auth.signOut(scope: SignOutScope.local);
    token = null;
  }

  @override
  Future<dynamic> call(
    String method,
    String path, [
    Map<String, dynamic>? data,
    bool raw = false,
  ]) async {
    try {
      return await _call(
        method,
        path,
        data ?? {},
      ).timeout(const Duration(seconds: 20));
    } on ApiError {
      rethrow;
    } on AuthException catch (e) {
      final text = switch (e.code) {
        'invalid_credentials' => 'E-mail ou senha incorretos.',
        'email_not_confirmed' => 'Confirme seu e-mail antes de entrar.',
        'user_already_exists' ||
        'email_exists' => 'Este e-mail já está cadastrado.',
        'over_email_send_rate_limit' || 'over_request_rate_limit' =>
          'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
        'weak_password' =>
          'Escolha uma senha mais forte, com pelo menos 10 caracteres.',
        'captcha_failed' || 'captcha_invalid' || 'captcha_timeout' => 'A verificação de segurança falhou ou expirou. Refaça a verificação e tente novamente.',
        _ => 'Não foi possível concluir a autenticação. Confira seus dados e tente novamente.',
      };
      throw ApiError(text, int.tryParse(e.statusCode ?? '') ?? 400);
    } on PostgrestException catch (e) {
      if (e.code == 'PGRST202') {
        throw ApiError(
          'O banco do site ainda não foi configurado. Avise o responsável pelo projeto.',
        );
      }
      if (e.code == 'PGRST301' || e.code == '28000') {
        throw ApiError('Sua sessão expirou. Saia e entre novamente.', 401);
      }
      if (e.code == '42501') throw ApiError(e.message, 403);
      throw ApiError(
        e.code == 'P0001'
            ? e.message
            : 'Não foi possível salvar ou consultar os dados. Tente novamente.',
      );
    } catch (_) {
      throw ApiError(
        'Não foi possível acessar o servidor. Verifique sua conexão e tente novamente.',
      );
    }
  }

  Future<dynamic> _call(
    String method,
    String path,
    Map<String, dynamic> data,
  ) async {
    if (path == '/auth/register' || path == '/auth/login') {
      final captchaToken = _captchaToken(data);
      final AuthResponse response;
      if (path.endsWith('register')) {
        response = await supabase.auth.signUp(
          email: (data['email'] as String).trim(),
          password: data['password'],
          data: {'name': data['name'], 'role': data['role'], 'consent': true},
          emailRedirectTo: _webOrigin,
          captchaToken: captchaToken,
        );
        if (response.session == null) return {'confirmation_required': true};
      } else {
        response = await supabase.auth.signInWithPassword(
          email: (data['email'] as String).trim(),
          password: data['password'],
          captchaToken: captchaToken,
        );
      }
      token = response.session?.accessToken;
      return {'token': token, 'user': await rpc('me')};
    }
    if (path == '/auth/logout') {
      await supabase.auth.signOut(scope: SignOutScope.local);
      token = null;
      return null;
    }
    if (path == '/auth/reset') {
      final captchaToken = _captchaToken(data);
      await supabase.auth.resetPasswordForEmail(
        data['email'],
        redirectTo: _webOrigin == null ? null : '$_webOrigin/?recovery=1',
        captchaToken: captchaToken,
      );
      return null;
    }
    if (path == '/auth/password') {
      await supabase.auth.updateUser(
        UserAttributes(password: data['password']),
      );
      return null;
    }
    if (supabase.auth.currentSession == null) {
      throw ApiError('Entre novamente para continuar.', 401);
    }
    token = supabase.auth.currentSession!.accessToken;
    if (path == '/auth/me') return rpc('me');
    final uri = Uri.parse(path), parts = Uri.parse(path).pathSegments;
    if (parts.length == 1 && parts[0] == 'children') {
      return rpc(method == 'POST' ? 'add_child' : 'children', data: data);
    }
    if (parts.length < 3 || parts[0] != 'children') {
      throw ApiError('Operação desconhecida.');
    }
    final cid = int.parse(parts[1]),
        target = parts.length == 4 ? parts[3] : null;
    final action = switch ((parts[2], method)) {
      ('words', 'GET') => 'words',
      ('words', 'POST') => 'add_word',
      ('words', 'PUT') => 'edit_word',
      ('events', 'GET') => 'history',
      ('events', 'POST') => 'add_event',
      ('report', 'GET') || ('report.csv', 'GET') => 'report',
      ('members', 'GET') => 'members',
      ('members', 'POST') => 'grant',
      ('members', 'DELETE') => 'revoke',
      _ => throw ApiError('Operação desconhecida.'),
    };
    final result = await rpc(
      action,
      child: cid,
      target: target,
      data: {
        ...data,
        if (uri.queryParameters['days'] != null)
          'days': int.parse(uri.queryParameters['days']!),
        if (uri.queryParameters['before'] != null)
          'before': int.parse(uri.queryParameters['before']!),
      },
    );
    return parts[2] == 'report.csv'
        ? reportCsv(Map<String, dynamic>.from(result))
        : result;
  }

  String? _captchaToken(Map<String, dynamic> data) {
    final value = data['captchaToken'];
    final token = value is String && value.trim().isNotEmpty ? value : null;
    if (turnstileSiteKey.isNotEmpty && token == null) {
      throw ApiError('Conclua a verificação de segurança para continuar.');
    }
    return token;
  }

  Future<dynamic> rpc(
    String action, {
    int? child,
    String? target,
    Map<String, dynamic> data = const {},
  }) => supabase.rpc(
    'comunica_api',
    params: {
      'p_action': action,
      'p_child': child,
      'p_target': target,
      'p_data': data,
    },
  );
}

String reportCsv(Map<String, dynamic> report) {
  String cell(dynamic value) {
    var text = '$value';
    if (RegExp(r'^\s*[=+@-]').hasMatch(text)) text = "'$text";
    return '"${text.replaceAll('"', '""')}"';
  }

  final rows = <List<dynamic>>[
    [
      'Criança',
      'Período (dias)',
      'Palavra',
      'Categoria',
      'Usos no período',
      'Última avaliação (todo histórico)',
      'Na prancha',
    ],
    for (final w in report['words'])
      [
        report['child_name'],
        report['days'],
        w['label'],
        w['category'],
        w['uses'],
        w['stage'] == null ? 'Sem avaliação' : stages[w['stage']],
        w['active'] == 1 ? 'Sim' : 'Não',
      ],
  ];
  return '\ufeff${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n';
}
