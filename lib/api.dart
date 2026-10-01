import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class ApiError implements Exception {
  final String message;
  final int status;
  ApiError(this.message, [this.status = 0]);
  @override
  String toString() => message;
}

class Api {
  static const baseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );
  final http.Client client;
  final FlutterSecureStorage storage;
  String? token;
  Api({http.Client? client, FlutterSecureStorage? storage})
    : client = client ?? http.Client(),
      storage = storage ?? const FlutterSecureStorage();
  Future<void> restore() async {
    token = await storage.read(key: 'session');
  }

  Future<void> remember(String value) async {
    await storage.write(key: 'session', value: value);
    token = value;
  }

  Future<void> forget() async {
    token = null;
    await storage.delete(key: 'session');
  }

  Future<List<Map<String, dynamic>>> readPending(String scope) async {
    final entries = await storage.readAll();
    return entries.entries
        .where((e) => e.key.startsWith('pending_${scope}_'))
        .map((e) => Map<String, dynamic>.from(jsonDecode(e.value)))
        .toList()
      ..sort(
        (a, b) =>
            (a['request_id'] as String).compareTo(b['request_id'] as String),
      );
  }

  Future<void> savePending(String scope, Map<String, dynamic> event) =>
      storage.write(
        key: 'pending_${scope}_${event['request_id']}',
        value: jsonEncode(event),
      );
  Future<void> removePending(String scope, Map<String, dynamic> event) =>
      storage.delete(key: 'pending_${scope}_${event['request_id']}');

  Future<dynamic> call(
    String method,
    String path, [
    Map<String, dynamic>? data,
    bool raw = false,
  ]) async {
    final uri = Uri.parse('$baseUrl$path');
    if (kReleaseMode && uri.scheme != 'https') {
      throw ApiError(
        'Configure um endereço HTTPS para a versão de distribuição.',
      );
    }
    try {
      final request = http.Request(method, uri);
      request.headers.addAll({
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      });
      if (data != null) request.body = jsonEncode(data);
      final response = await http.Response.fromStream(
        await client.send(request),
      ).timeout(const Duration(seconds: 15));
      if (response.statusCode >= 400) {
        dynamic detail;
        try {
          detail = jsonDecode(utf8.decode(response.bodyBytes))['detail'];
        } catch (_) {
          /* Proxy errors may not be JSON. */
        }
        throw ApiError(
          detail is String ? detail : 'Confira os dados e tente novamente.',
          response.statusCode,
        );
      }
      if (response.bodyBytes.isEmpty) return null;
      return raw
          ? utf8.decode(response.bodyBytes)
          : jsonDecode(utf8.decode(response.bodyBytes));
    } on ApiError {
      rethrow;
    } catch (_) {
      throw ApiError(
        'Não foi possível acessar o servidor. Verifique a conexão e tente novamente.',
      );
    }
  }
}

String requestId() {
  final random = Random.secure();
  return List.generate(
    24,
    (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
}

const stages = [
  'CAA utilizada',
  'Tentativa de vocalização',
  'Palavra falada',
  'Domínio da palavra',
];
String formatDate(String iso) {
  final d = DateTime.parse(iso).toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} às ${two(d.hour)}:${two(d.minute)}';
}
