import 'dart:js_interop';

import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

import 'turnstile_controller.dart';

@JS('comunicaTurnstileMount')
external void _mount(
  web.HTMLElement container,
  JSString siteKey,
  JSBoolean compact,
  JSFunction onVerified,
  JSFunction onExpired,
  JSFunction onFailed,
);
@JS('comunicaTurnstileReset')
external void _reset(web.HTMLElement container);
@JS('comunicaTurnstileRemove')
external void _remove(web.HTMLElement container);

class TurnstileWidget extends StatefulWidget {
  final TurnstileController controller;
  const TurnstileWidget({super.key, required this.controller});

  @override
  State<TurnstileWidget> createState() => _TurnstileWidgetState();
}

class _TurnstileWidgetState extends State<TurnstileWidget> {
  web.HTMLElement? _container;

  void reset() {
    if (_container != null) _reset(_container!);
  }

  @override
  void initState() {
    super.initState();
    widget.controller.resetWidget = reset;
  }

  @override
  void dispose() {
    widget.controller.resetWidget = null;
    if (_container != null) _remove(_container!);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final compact = constraints.maxWidth < 300;
      return SizedBox(
        height: compact ? 140 : 65,
        child: HtmlElementView.fromTagName(
          key: ValueKey(compact),
          tagName: 'div',
          onElementCreated: (element) {
            final container = element as web.HTMLElement;
            if (_container != null) _remove(_container!);
            _container = container;
            container.style
              ..width = '100%'
              ..height = '100%'
              ..display = 'flex'
              ..justifyContent = 'center';
            container.setAttribute('aria-label', 'Verificação de segurança');
            _mount(
              container,
              widget.controller.siteKey.toJS,
              compact.toJS,
              ((JSString token) {
                if (mounted) widget.controller.verified(token.toDart);
              }).toJS,
              (() {
                if (mounted) widget.controller.expired();
              }).toJS,
              (() {
                if (mounted) widget.controller.failed();
              }).toJS,
            );
          },
        ),
      );
    },
  );
}
