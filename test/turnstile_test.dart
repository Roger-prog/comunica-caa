import 'dart:convert';

import 'package:comunica/api.dart';
import 'package:comunica/screens.dart';
import 'package:comunica/supabase_api.dart';
import 'package:comunica/turnstile_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

SupabaseClient clientWith(http.Client client) => SupabaseClient(
  'https://supabase.invalid',
  'sb_publishable_test',
  httpClient: client,
  authOptions: const AuthClientOptions(
    autoRefreshToken: false,
    authFlowType: AuthFlowType.implicit,
  ),
);

class FakeAuthApi extends SupabaseApi {
  final attempts = <Map<String, dynamic>>[];
  FakeAuthApi()
    : super(
        clientWith(MockClient((_) async => http.Response('{}', 200))),
        turnstileSiteKey: 'public-test-sitekey',
        emailRecoveryEnabled: true,
      );

  @override
  Future<dynamic> call(
    String method,
    String path, [
    Map<String, dynamic>? data,
    bool raw = false,
  ]) async {
    attempts.add({'path': path, ...?data});
    throw ApiError('Tentativa recusada no teste.');
  }
}

void main() {
  testWidgets('Challenge tokens expire and authorize only one attempt', (
    tester,
  ) async {
    final captcha = TurnstileController(
      'public-test-sitekey',
      tokenLifetime: const Duration(seconds: 2),
    );
    addTearDown(captcha.dispose);
    expect(captcha.takeToken(), isNull);
    captcha.verified('first-response');
    expect(captcha.ready, isTrue);
    expect(captcha.takeToken(), 'first-response');
    expect(captcha.takeToken(), isNull);
    captcha.verified('expiring-response');
    await tester.pump(const Duration(seconds: 3));
    expect(captcha.ready, isFalse);
    expect(captcha.takeToken(), isNull);
    expect(captcha.status, contains('expirou'));
    captcha.verified('failed-response');
    captcha.failed();
    expect(captcha.takeToken(), isNull);
  });

  test(
    'Configured adapter refuses missing captcha on every public auth route',
    () async {
      var requests = 0;
      final client = clientWith(
        MockClient((_) async {
          requests++;
          return http.Response('{}', 200);
        }),
      );
      addTearDown(client.dispose);
      final api = SupabaseApi(client, turnstileSiteKey: 'public-test-sitekey');
      for (final path in ['/auth/login', '/auth/register', '/auth/reset']) {
        for (final token in [null, '', '   ']) {
          await expectLater(
            api.call('POST', path, {
              'email': 'demo@example.com',
              'password': 'senha-ficticia-123',
              'name': 'Teste',
              'role': 'responsavel',
              'captchaToken': token,
            }),
            throwsA(
              isA<ApiError>().having(
                (error) => error.message,
                'message',
                contains('Conclua a verificação'),
              ),
            ),
          );
        }
      }
      expect(requests, 0);
    },
  );

  test(
    'Supabase receives captchaToken for login, registration and recovery',
    () async {
      final requests = <Map<String, dynamic>>[];
      final client = clientWith(
        MockClient((request) async {
          requests.add({'path': request.url.path, ...jsonDecode(request.body)});
          return http.Response(
            jsonEncode({
              'code': 'captcha_failed',
              'msg': 'Captcha verification failed',
            }),
            400,
            headers: {
              'content-type': 'application/json',
              'x-supabase-api-version': '2024-01-01',
            },
          );
        }),
      );
      addTearDown(client.dispose);
      final api = SupabaseApi(client, turnstileSiteKey: 'public-test-sitekey');
      for (final path in ['/auth/login', '/auth/register', '/auth/reset']) {
        await expectLater(
          api.call('POST', path, {
            'email': 'demo@example.com',
            'password': 'senha-ficticia-123',
            'name': 'Teste',
            'role': 'responsavel',
            'captchaToken': 'response-$path',
          }),
          throwsA(
            isA<ApiError>().having(
              (error) => error.message,
              'message',
              contains('Refaça a verificação'),
            ),
          ),
        );
      }
      expect(requests.map((request) => request['path']), [
        '/auth/v1/token',
        '/auth/v1/signup',
        '/auth/v1/recover',
      ]);
      for (var index = 0; index < requests.length; index++) {
        expect(
          requests[index]['gotrue_meta_security']['captcha_token'],
          [
            'response-/auth/login',
            'response-/auth/register',
            'response-/auth/reset',
          ][index],
        );
      }
    },
  );

  testWidgets(
    'Login blocks until verified and resets after a rejected attempt',
    (tester) async {
      final api = (await tester.runAsync(() async => FakeAuthApi()))!;
      final captcha = TurnstileController('public-test-sitekey');
      addTearDown(() => tester.runAsync(api.supabase.dispose));
      addTearDown(captcha.dispose);
      var resets = 0;
      captcha.resetWidget = () => resets++;
      await tester.pumpWidget(
        MaterialApp(
          home: AuthScreen(
            api: api,
            captchaController: captcha,
            onLogin: (_) {},
          ),
        ),
      );
      await tester.enterText(
        find.byType(TextFormField).at(0),
        'demo@example.com',
      );
      await tester.enterText(
        find.byType(TextFormField).at(1),
        'senha-ficticia-123',
      );
      final submit = find.widgetWithText(FilledButton, 'Entrar');
      await tester.ensureVisible(submit);
      await tester.pumpAndSettle();
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(api.attempts, isEmpty);
      expect(
        find.text('Conclua a verificação de segurança para continuar.'),
        findsOneWidget,
      );
      captcha.verified('single-response');
      await tester.pump();
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(api.attempts.single['captchaToken'], 'single-response');
      expect(captcha.ready, isFalse);
      expect(resets, 1);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(api.attempts, hasLength(1));
    },
  );

  testWidgets('Recovery token expiring in the dialog prevents the request', (
    tester,
  ) async {
    final api = (await tester.runAsync(() async => FakeAuthApi()))!;
    final captcha = TurnstileController('public-test-sitekey');
    addTearDown(() => tester.runAsync(api.supabase.dispose));
    addTearDown(captcha.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: AuthScreen(api: api, captchaController: captcha, onLogin: (_) {}),
      ),
    );
    captcha.verified('old-response');
    final recover = find.text('Esqueci minha senha');
    await tester.ensureVisible(recover);
    await tester.pumpAndSettle();
    await tester.tap(recover);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextFormField),
      ),
      'demo@example.com',
    );
    captcha.expired();
    await tester.tap(find.widgetWithText(FilledButton, 'Continuar'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(api.attempts, isEmpty);
    expect(
      find.text('A verificação expirou. Refaça a verificação.'),
      findsOneWidget,
    );
  });
}
