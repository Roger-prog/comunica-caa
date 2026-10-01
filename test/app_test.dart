import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:comunica/api.dart';
import 'package:comunica/main.dart';
import 'package:comunica/screens.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('flutter_tts'),
          (_) async => 1,
        );
  });

  test('API sends authorization and UTF-8 and exposes server errors', () async {
    final api = Api(
      client: MockClient((r) async {
        expect(r.headers['Authorization'], 'Bearer token');
        expect(jsonDecode(r.body)['name'], 'Criança');
        return http.Response(jsonEncode({'detail': 'Sem acesso'}), 403);
      }),
    )..token = 'token';
    await expectLater(
      api.call('POST', '/children', {'name': 'Criança'}),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 403)),
    );
  });

  test(
    'Pending records survive a new API instance and stay scoped by child',
    () async {
      final api = Api();
      final event = <String, dynamic>{
        'word_id': 1,
        'kind': 'use',
        'stage': 0,
        'request_id': 'persistent-request-0001',
      };
      await api.savePending('1_10', event);
      final reopened = Api();
      expect(await reopened.readPending('1_10'), [event]);
      expect(await reopened.readPending('1_11'), isEmpty);
      expect(await reopened.readPending('2_10'), isEmpty);
      await reopened.removePending('1_10', event);
      expect(await api.readPending('1_10'), isEmpty);
    },
  );

  testWidgets('Login validates before sending and opens account', (
    tester,
  ) async {
    var requests = 0;
    final api = Api(
      client: MockClient((r) async {
        requests++;
        if (r.url.path == '/auth/login') {
          return http.Response(
            jsonEncode({
              'token': 'session-token',
              'user': {
                'id': 1,
                'name': 'Responsável',
                'email': 'teste@example.com',
                'role': 'responsavel',
              },
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response('[]', 200);
      }),
    );
    await tester.pumpWidget(ComunicaApp(api: api));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();
    expect(find.text('Informe um e-mail válido'), findsOneWidget);
    expect(requests, 0);
    await tester.enterText(
      find.byType(TextFormField).at(0),
      'teste@example.com',
    );
    await tester.enterText(find.byType(TextFormField).at(1), 'senha-teste-123');
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();
    expect(find.text('Olá, Responsável.'), findsOneWidget);
    expect(await api.storage.read(key: 'session'), 'session-token');
  });

  testWidgets('Board sends use only; dashboard has manual evaluation', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(() => tester.view.resetPhysicalSize());
    final events = <Map<String, dynamic>>[];
    final word = {
      'id': 1,
      'child_id': 1,
      'label': 'Água',
      'symbol': '💧',
      'category': 'Necessidades',
      'active': 1,
      'uses': 0,
      'stage': null,
    };
    final api = Api(
      client: MockClient((r) async {
        dynamic body = [];
        if (r.url.path.endsWith('/words')) body = [word];
        if (r.url.path.endsWith('/report')) {
          body = {
            'total_uses': events.length,
            'mastered': 0,
            'words': [word],
            'daily': [],
          };
        }
        if (r.method == 'POST') {
          events.add(Map<String, dynamic>.from(jsonDecode(r.body)));
          body = {'id': events.length};
        }
        return http.Response(
          jsonEncode(body),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: ChildScreen(
          api: api,
          user: const {'id': 1},
          child: const {'id': 1, 'name': 'Teste', 'owner_id': 1},
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Água'));
    await tester.pumpAndSettle();
    expect(events.single['kind'], 'use');
    expect(events.single['stage'], 0);
    await tester.tap(find.text('Evolução'));
    await tester.pumpAndSettle();
    expect(find.text('Palavras dominadas¹'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Login fits compact screen with enlarged text', (tester) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: AuthScreen(api: Api(), onLogin: (_) {}),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
