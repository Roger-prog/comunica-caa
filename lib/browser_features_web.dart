import 'dart:convert';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

web.SpeechSynthesisUtterance? currentSpeech;
bool speakBrowser(String text, void Function() onError) {
  try {
    final speech = web.window.speechSynthesis;
    speech.cancel();
    final utterance = web.SpeechSynthesisUtterance(text)
      ..lang = 'pt-BR'
      ..rate = 0.85;
    final voices = speech.getVoices().toDart.where(
      (v) => v.lang.toLowerCase().startsWith('pt'),
    );
    if (voices.isNotEmpty) utterance.voice = voices.first;
    utterance.onerror = ((web.Event event) {
      // A newer tap intentionally cancels the previous word.
      if (currentSpeech == utterance) onError();
    }).toJS;
    currentSpeech = utterance;
    // Synchronous call in the click handler preserves Safari's user activation.
    speech.speak(utterance);
    return true;
  } catch (_) {
    return false;
  }
}

bool downloadCsv(String csv) {
  final blob = web.Blob(
    [utf8.encode(csv).toJS].toJS,
    web.BlobPropertyBag(type: 'text/csv;charset=utf-8'),
  );
  final url = web.URL.createObjectURL(blob);
  final link = web.HTMLAnchorElement()
    ..href = url
    ..download = 'evolucao.csv';
  web.document.body!.appendChild(link);
  link.click();
  link.remove();
  Future<void>.delayed(
    const Duration(seconds: 30),
    () => web.URL.revokeObjectURL(url),
  );
  return true;
}

@JS('comunicaRegisterSearch')
external void _registerSearch(JSFunction callback);
@JS('comunicaUnregisterSearch')
external void _unregisterSearch();
void registerVocabularySearch(void Function(String) search) {
  _registerSearch(
    ((JSString value) {
      search(value.toDart);
    }).toJS,
  );
}

void unregisterVocabularySearch() {
  _unregisterSearch();
}
