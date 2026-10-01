import 'package:flutter/widgets.dart';

import 'turnstile_controller.dart';

class TurnstileWidget extends StatelessWidget {
  final TurnstileController controller;
  const TurnstileWidget({super.key, required this.controller});

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
