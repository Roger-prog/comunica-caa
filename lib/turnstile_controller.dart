import 'dart:async';

import 'package:flutter/foundation.dart';

/// A challenge response can authorize only one authentication attempt.
class TurnstileController extends ChangeNotifier {
  final String siteKey;
  final Duration tokenLifetime;
  String? _token;
  Timer? _expiry;
  bool _disposed = false;
  String status = 'Aguarde a verificação de segurança.';
  VoidCallback? resetWidget;

  TurnstileController(
    this.siteKey, {
    this.tokenLifetime = const Duration(minutes: 4),
  });

  bool get ready => _token != null;

  void verified(String token) {
    if (_disposed) return;
    if (token.isEmpty) {
      failed();
      return;
    }
    _expiry?.cancel();
    _token = token;
    status = 'Verificação concluída.';
    // Turnstile expires in 5 minutes. Use a margin before the server deadline.
    _expiry = Timer(tokenLifetime, expired);
    notifyListeners();
  }

  void failed() => _invalidate(
    'Não foi possível verificar. Confira a conexão e refaça a verificação.',
  );

  void expired() => _invalidate(
    'A verificação expirou. Refaça a verificação para continuar.',
  );

  void _invalidate(String message) {
    if (_disposed) return;
    _expiry?.cancel();
    _token = null;
    status = message;
    notifyListeners();
  }

  String? takeToken() {
    final value = _token;
    if (value == null) return null;
    _invalidate('Aguarde a verificação de segurança.');
    return value;
  }

  void reset() {
    _invalidate('Aguarde a verificação de segurança.');
    resetWidget?.call();
  }

  @override
  void dispose() {
    _disposed = true;
    _expiry?.cancel();
    resetWidget = null;
    super.dispose();
  }
}
