import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:comunica/boot.dart';
import 'package:comunica/supabase_api.dart';

void main() {
  test('Configuração aceita chave pública e rejeita credenciais privilegiadas', () {
    String jwt(String role) =>
        'header.${base64Url.encode(utf8.encode(jsonEncode({'role': role})))}.signature';
    expect(validPublicKey('sb_publishable_example'), isTrue);
    expect(validPublicKey(jwt('anon')), isTrue);
    expect(validPublicKey(jwt('service_role')), isFalse);
    expect(validPublicKey('sb_secret_example'), isFalse);
    expect(validPublicKey(''), isFalse);
    expect(validPublicKey('invalid'), isFalse);
  });
  test('CSV preserva acentos e aspas e evita fórmulas de planilha', () {
    final csv = reportCsv({
      'child_name': 'Criança',
      'days': 7,
      'words': [
        {
          'label': 'Água; "fria"',
          'category': 'Necessidades',
          'uses': 2,
          'stage': null,
          'active': 1,
        },
        {
          'label': '=1+1',
          'category': 'Escolhas',
          'uses': 0,
          'stage': 3,
          'active': 0,
        },
      ],
    });
    expect(csv, startsWith('\ufeff'));
    expect(csv, contains('"Água; ""fria"""'));
    expect(csv, contains('"\'=1+1"'));
    expect(csv, contains('"Sem avaliação";"Sim"'));
    expect(csv, contains(';"Não"\r\n'));
    expect(csv, contains('Criança'));
  });
}
