import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:comunica/api.dart';
import 'package:comunica/main.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'Android: login, communication, evolution and persistent history',
    (tester) async {
      final api = Api();
      final suffix = DateTime.now().microsecondsSinceEpoch;
      final email = 'teste.$suffix@example.com';
      final registered = await api.call('POST', '/auth/register', {
        'name': 'Responsável de teste',
        'email': email,
        'password': 'teste-integracao-123',
        'role': 'responsavel',
      });
      api.token = registered['token'];
      final child = await api.call('POST', '/children', {
        'name': 'Perfil de teste',
      });
      await api.forget();
      await tester.pumpWidget(ComunicaApp(api: api));
      await tester.pumpAndSettle();
      await binding.convertFlutterSurfaceToImage();
      await tester.pumpAndSettle();
      await binding.takeScreenshot('01-entrada');
      await tester.enterText(find.byType(TextFormField).at(0), email);
      await tester.enterText(
        find.byType(TextFormField).at(1),
        'teste-integracao-123',
      );
      await tester.ensureVisible(find.widgetWithText(FilledButton, 'Entrar'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(find.text('Perfil de teste'), findsOneWidget);
      await tester.tap(find.text('Perfil de teste'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      await binding.takeScreenshot('02-prancha');
      await tester.tap(find.text('Água'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      final firstReport = await api.call(
        'GET',
        '/children/${child['id']}/report',
      );
      expect(firstReport['total_uses'], 1);
      expect(firstReport['mastered'], 0);
      await tester.tap(find.text('Evolução'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      await binding.takeScreenshot('03-evolucao');
      await Scrollable.ensureVisible(
        tester.element(find.text('Registrar evolução').first),
        alignment: 0.5,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Registrar evolução').first);
      await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<int>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Palavra falada').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField).last,
        'Observação de teste: falou durante a atividade.',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Registrar'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      await tester.tap(find.text('Histórico'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(find.text('Palavra falada'), findsOneWidget);
      await binding.takeScreenshot('04-historico');
      final events = await api.call('GET', '/children/${child['id']}/events');
      expect(events.length, 2);
      expect(events[0]['stage'], 2);
      expect(events[1]['kind'], 'use');
      await tester.tap(find.text('Ajustes'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Adicionar palavra'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).at(0), 'Música');
      await tester.tap(find.widgetWithText(FilledButton, 'Salvar'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      final words = await api.call('GET', '/children/${child['id']}/words');
      expect(words.any((w) => w['label'] == 'Música'), true);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Comunicar'));
      await tester.pumpAndSettle();
    },
  );
}
