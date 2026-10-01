import 'package:flutter/material.dart';

import 'api.dart';
import 'screens.dart';
import 'boot.dart';
import 'supabase_api.dart';
import 'password_recovery.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    runApp(ComunicaApp(api: await configuredApi()));
  } catch (_) {
    runApp(const SetupApp());
  }
}

const purple = Color(0xFF7043A7);
const ink = Color(0xFF302641);

class ComunicaApp extends StatelessWidget {
  final Api api;
  const ComunicaApp({super.key, required this.api});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Comunica',
    debugShowCheckedModeBanner: false,
    initialRoute: '/',
    builder: (context, child) => ColoredBox(
      color: const Color(0xFFEFEAF5),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1120),
          child: child!,
        ),
      ),
    ),
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: purple,
        surface: const Color(0xFFF9F7FC),
      ),
      scaffoldBackgroundColor: const Color(0xFFF9F7FC),
      textTheme: const TextTheme(
        headlineLarge: TextStyle(fontWeight: FontWeight.w800, color: ink),
        headlineMedium: TextStyle(fontWeight: FontWeight.w800, color: ink),
        titleLarge: TextStyle(fontWeight: FontWeight.w700, color: ink),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFFF9F7FC),
        foregroundColor: ink,
        centerTitle: false,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xFFDED5E8)),
        ),
        contentPadding: const EdgeInsets.all(18),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: Colors.white,
        margin: const EdgeInsets.only(bottom: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: const BorderSide(color: Color(0xFFEAE4F1)),
        ),
      ),
      useMaterial3: true,
    ),
    home: SessionGate(api: api),
  );
}

class SessionGate extends StatefulWidget {
  final Api api;
  const SessionGate({super.key, required this.api});
  @override
  State<SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<SessionGate> {
  Map<String, dynamic>? user;
  bool loading = true;
  bool recovering = false;
  String? error;
  @override
  void initState() {
    super.initState();
    recovering =
        widget.api is SupabaseApi && (widget.api as SupabaseApi).recovery;
    restore();
  }

  Future<void> restore() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      await widget.api.restore();
      if (widget.api.token != null) {
        user = Map<String, dynamic>.from(
          await widget.api.call('GET', '/auth/me'),
        );
      }
    } on ApiError catch (e) {
      if (e.status == 401) {
        await widget.api.forget();
      } else {
        error = e.message;
      }
    } catch (_) {
      error = 'Não foi possível abrir a sessão segura. Tente novamente.';
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> logout() async {
    try {
      await widget.api.call('POST', '/auth/logout');
    } on ApiError catch (e) {
      if (e.status != 401) rethrow;
    }
    await widget.api.forget();
    if (mounted) setState(() => user = null);
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (recovering) {
      return PasswordRecovery(
        api: widget.api,
        onDone: () {
          setState(() => recovering = false);
          restore();
        },
      );
    }
    if (error != null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(error!),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: restore,
                  child: const Text('Tentar novamente'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    if (user == null) {
      return AuthScreen(
        api: widget.api,
        onLogin: (u) => setState(() => user = u),
      );
    }
    return ChildrenScreen(api: widget.api, user: user!, logout: logout);
  }
}
