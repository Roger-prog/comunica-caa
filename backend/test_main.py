import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("TTS_ALLOWED_ORIGINS", raising=False)
    with TestClient(main.create_app()) as instance:
        yield instance


def install_stream(monkeypatch, chunks, captured=None, delay=0.0):
    class FakeCommunicate:
        def __init__(self, text, voice, **kwargs):
            if captured is not None:
                captured.update(text=text, voice=voice, **kwargs)

        async def stream(self):
            if delay:
                await asyncio.sleep(delay)
            for chunk in chunks:
                yield chunk

    monkeypatch.setattr(main.edge_tts, "Communicate", FakeCommunicate)


def test_health_never_contacts_provider(client, monkeypatch):
    def unexpected(*_args, **_kwargs):
        pytest.fail("Health cannot contact the provider")
    monkeypatch.setattr(main.edge_tts, "Communicate", unexpected)
    assert client.get("/health").json() == {"status": "ok"}


def test_mp3_response_and_defaults(client, monkeypatch):
    captured = {}
    install_stream(monkeypatch, [{"type": "SentenceBoundary", "text": "ignored"}, {"type": "audio", "data": b"ID3first"}, {"type": "audio", "data": b"second"}], captured)
    response = client.post("/api/tts", json={"text": "  Olá, mundo!  "})
    assert response.status_code == 200
    assert response.content == b"ID3firstsecond"
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert captured == {"text": "Olá, mundo!", "voice": "pt-BR-FranciscaNeural", "rate": "+0%"}


def test_alternative_voice_and_rate(client, monkeypatch):
    captured = {}
    install_stream(monkeypatch, [{"type": "audio", "data": b"ID3audio"}], captured)
    response = client.post("/api/tts", json={"text": "Água", "voice": "pt-BR-AntonioNeural", "rate": 0.8})
    assert response.status_code == 200
    assert captured["voice"] == "pt-BR-AntonioNeural"
    assert captured["rate"] == "-20%"


def test_repeated_normalized_text_reuses_complete_audio(client, monkeypatch):
    calls = []

    class CountingCommunicate:
        def __init__(self, text, voice, **kwargs):
            calls.append((text, voice, kwargs["rate"]))

        async def stream(self):
            yield {"type": "audio", "data": b"ID3cached"}

    monkeypatch.setattr(main.edge_tts, "Communicate", CountingCommunicate)
    first = client.post("/api/tts", json={"text": "  Água  "})
    second = client.post("/api/tts", json={"text": "Água"})
    assert first.status_code == second.status_code == 200
    assert first.content == second.content == b"ID3cached"
    assert second.headers["content-length"] == str(len(b"ID3cached"))
    assert second.headers["cache-control"] == "no-store"
    assert calls == [("Água", "pt-BR-FranciscaNeural", "+0%")]


def test_cache_distinguishes_voice_text_and_effective_rate(client, monkeypatch):
    calls = []

    class CountingCommunicate:
        def __init__(self, text, voice, **kwargs):
            calls.append((text, voice, kwargs["rate"]))

        async def stream(self):
            yield {"type": "audio", "data": str(len(calls)).encode()}

    monkeypatch.setattr(main.edge_tts, "Communicate", CountingCommunicate)
    payloads = [
        {"text": "Água", "rate": 0.8},
        {"text": "Água", "rate": 0.8001},  # Same -20% passed to edge-tts.
        {"text": "Água", "rate": 1.0},
        {"text": "Água", "rate": 0.8, "voice": "pt-BR-AntonioNeural"},
        {"text": "Mais", "rate": 0.8},
    ]
    responses = [client.post("/api/tts", json=payload) for payload in payloads]
    assert all(response.status_code == 200 for response in responses)
    assert [response.content for response in responses] == [b"1", b"1", b"2", b"3", b"4"]
    assert len(calls) == 4


def test_cache_hit_bypasses_busy_synthesis_slots(monkeypatch):
    entered = Event()
    release = Event()
    monkeypatch.setattr(main, "MAX_CONCURRENT_REQUESTS", 1)
    monkeypatch.setattr(main, "QUEUE_TIMEOUT_SECONDS", 0.01)

    class ControlledCommunicate:
        def __init__(self, text, *_args, **_kwargs):
            self.text = text

        async def stream(self):
            if self.text == "Aguardando":
                entered.set()
                while not release.is_set():
                    await asyncio.sleep(0.005)
            yield {"type": "audio", "data": b"ID3cached"}

    monkeypatch.setattr(main.edge_tts, "Communicate", ControlledCommunicate)
    with TestClient(main.create_app()) as instance, ThreadPoolExecutor(max_workers=1) as pool:
        assert instance.post("/api/tts", json={"text": "Água"}).status_code == 200
        held = pool.submit(instance.post, "/api/tts", json={"text": "Aguardando"})
        try:
            assert entered.wait(timeout=2)
            cached = instance.post("/api/tts", json={"text": "Água"})
            assert cached.status_code == 200
            assert cached.content == b"ID3cached"
            assert instance.post("/api/tts", json={"text": "Outro"}).status_code == 503
        finally:
            release.set()
        assert held.result(timeout=2).status_code == 200


def test_cache_rechecks_after_acquiring_slot(client, monkeypatch):
    payload = main.TTSRequest(text="Água")
    cache = client.app.state.audio_cache

    class FillingSlot:
        released = False

        async def acquire(self):
            cache.put(main.cache_key(payload), b"ID3completed-while-waiting")

        def release(self):
            self.released = True

    slot = FillingSlot()
    client.app.state.tts_slots = slot

    def unexpected(*_args, **_kwargs):
        pytest.fail("The cache was not checked again after slot acquisition")

    monkeypatch.setattr(main.edge_tts, "Communicate", unexpected)
    response = client.post("/api/tts", json={"text": "Água"})
    assert response.status_code == 200
    assert response.content == b"ID3completed-while-waiting"
    assert slot.released


def test_failed_partial_audio_is_not_cached(client, monkeypatch):
    calls = []

    class FailsOnceCommunicate:
        def __init__(self, *_args, **_kwargs):
            calls.append(True)
            self.attempt = len(calls)

        async def stream(self):
            yield {"type": "audio", "data": b"partial"}
            if self.attempt == 1:
                raise RuntimeError("provider failed after partial audio")
            yield {"type": "audio", "data": b"complete"}

    monkeypatch.setattr(main.edge_tts, "Communicate", FailsOnceCommunicate)
    assert client.post("/api/tts", json={"text": "Água"}).status_code == 502
    assert not client.app.state.audio_cache.entries
    complete = client.post("/api/tts", json={"text": "Água"})
    cached = client.post("/api/tts", json={"text": "Água"})
    assert complete.status_code == cached.status_code == 200
    assert complete.content == cached.content == b"partialcomplete"
    assert len(calls) == 2


def test_audio_cache_evicts_least_recently_used_by_entry_count():
    cache = main.AudioCache(max_entries=2)
    first, second, third = [(text, "pt-BR-FranciscaNeural", 0) for text in ("Água", "Mais", "Olá")]
    cache.put(first, b"one")
    cache.put(second, b"two")
    assert cache.get(first) == b"one"  # Marks first as recently used.
    cache.put(third, b"three")
    assert cache.get(second) is None
    assert cache.get(first) == b"one"
    assert cache.get(third) == b"three"
    assert cache.size_bytes == 8


def test_audio_cache_enforces_byte_budget_and_skips_oversized_audio():
    cache = main.AudioCache(max_entries=10, max_bytes=6)
    first, second, third = [(text, "pt-BR-FranciscaNeural", 0) for text in ("Água", "Mais", "Olá")]
    cache.put(first, b"one")
    cache.put(second, b"twotwo")
    assert cache.get(first) is None
    assert cache.get(second) == b"twotwo"
    cache.put(third, b"too-large")
    assert cache.get(third) is None
    assert cache.size_bytes == 6


def test_audio_cache_has_fixed_ttl_and_removes_expired_entries():
    now = [0.0]
    cache = main.AudioCache(ttl_seconds=10, clock=lambda: now[0])
    key = ("Água", "pt-BR-FranciscaNeural", 0)
    cache.put(key, b"ID3")
    now[0] = 9
    assert cache.get(key) == b"ID3"
    now[0] = 10
    assert cache.get(key) is None  # Reads do not renew retention.
    assert cache.size_bytes == 0
    assert not cache.entries
    cache.put(key, b"new")
    now[0] = 21
    cache.put(("Mais", "pt-BR-FranciscaNeural", 0), b"ok")
    assert len(cache.entries) == 1  # Writes also remove expired entries.
    assert cache.size_bytes == 2


def test_audio_cache_lifespan_is_not_shared_and_clears_on_shutdown(monkeypatch):
    install_stream(monkeypatch, [{"type": "audio", "data": b"ID3"}])
    application = main.create_app()
    with TestClient(application) as instance:
        assert instance.post("/api/tts", json={"text": "Água"}).status_code == 200
        old_cache = application.state.audio_cache
        assert old_cache.size_bytes == 3
    assert old_cache.size_bytes == 0
    assert not old_cache.entries
    with TestClient(application):
        assert application.state.audio_cache is not old_cache
        assert not application.state.audio_cache.entries


@pytest.mark.parametrize("payload", [
    {}, {"text": ""}, {"text": " \t\n "}, {"text": "x" * 1001}, {"text": 12},
    {"text": "Olá\x00"}, {"text": "Olá", "voice": "arbitrary"},
    {"text": "Olá", "rate": "1"}, {"text": "Olá", "rate": True},
    {"text": "Olá", "rate": 0.49}, {"text": "Olá", "rate": 1.51},
    {"text": "Olá", "extra": "not allowed"},
])
def test_invalid_payload_is_not_forwarded_or_echoed(client, monkeypatch, payload):
    def unexpected(*_args, **_kwargs):
        pytest.fail("Invalid payload reached the provider")
    monkeypatch.setattr(main.edge_tts, "Communicate", unexpected)
    response = client.post("/api/tts", json=payload)
    assert response.status_code == 422
    assert response.json() == {"detail": "Dados de síntese inválidos."}


def test_oversized_content_length_rejected(client, monkeypatch):
    def unexpected(*_args, **_kwargs):
        pytest.fail("Oversized request reached the provider")
    monkeypatch.setattr(main.edge_tts, "Communicate", unexpected)
    response = client.post("/api/tts", content=b"x" * (main.MAX_BODY_BYTES + 1), headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_chunked_oversized_body_rejected(client):
    def chunks():
        yield b"x" * 10_000
        yield b"y" * 10_000
    response = client.post("/api/tts", content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_provider_error_has_no_private_diagnostics(client, monkeypatch):
    def failed(*_args, **_kwargs):
        raise RuntimeError("private diagnostic with supplied phrase")
    monkeypatch.setattr(main.edge_tts, "Communicate", failed)
    response = client.post("/api/tts", json={"text": "Frase fictícia"})
    assert response.status_code == 502
    assert response.json() == {"detail": "Não foi possível gerar o áudio."}
    assert "private" not in response.text


def test_empty_audio_is_an_error(client, monkeypatch):
    install_stream(monkeypatch, [{"type": "SentenceBoundary"}])
    assert client.post("/api/tts", json={"text": "Olá"}).status_code == 502


def test_audio_memory_cap_is_enforced(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 5)
    install_stream(monkeypatch, [{"type": "audio", "data": b"123"}, {"type": "audio", "data": b"456"}])
    assert client.post("/api/tts", json={"text": "Olá"}).status_code == 502


def test_timeout_releases_capacity(client, monkeypatch):
    monkeypatch.setattr(main, "SYNTHESIS_TIMEOUT_SECONDS", 0.01)
    install_stream(monkeypatch, [{"type": "audio", "data": b"ID3"}], delay=0.1)
    assert client.post("/api/tts", json={"text": "Olá"}).status_code == 504
    install_stream(monkeypatch, [{"type": "audio", "data": b"ID3"}])
    assert client.post("/api/tts", json={"text": "Olá"}).status_code == 200


def test_busy_service_returns_503_without_unbounded_queue(monkeypatch):
    entered = Event()
    release = Event()
    monkeypatch.setattr(main, "MAX_CONCURRENT_REQUESTS", 1)
    monkeypatch.setattr(main, "QUEUE_TIMEOUT_SECONDS", 0.01)

    class HeldCommunicate:
        def __init__(self, *_args, **_kwargs):
            pass
        async def stream(self):
            entered.set()
            while not release.is_set():
                await asyncio.sleep(0.005)
            yield {"type": "audio", "data": b"ID3audio"}

    monkeypatch.setattr(main.edge_tts, "Communicate", HeldCommunicate)
    with TestClient(main.create_app()) as instance, ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(instance.post, "/api/tts", json={"text": "Olá"})
        try:
            assert entered.wait(timeout=2)
            response = instance.post("/api/tts", json={"text": "Outro"})
            assert response.status_code == 503
            assert response.headers["retry-after"] == "1"
        finally:
            release.set()
        assert first.result(timeout=2).status_code == 200


def test_cors_exact_origin_and_no_credentials(client, monkeypatch):
    install_stream(monkeypatch, [{"type": "audio", "data": b"ID3audio"}])
    allowed = client.post("/api/tts", json={"text": "Olá"}, headers={"Origin": "http://127.0.0.1:5173"})
    assert allowed.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert "access-control-allow-credentials" not in allowed.headers
    forbidden = client.post("/api/tts", json={"text": "Olá"}, headers={"Origin": "https://example.invalid"})
    assert forbidden.status_code == 403
    assert "access-control-allow-origin" not in forbidden.headers
    preflight = client.options("/api/tts", headers={"Origin": "https://example.invalid", "Access-Control-Request-Method": "POST"})
    assert preflight.status_code == 400


def test_origin_configuration_rejects_wildcard(monkeypatch):
    monkeypatch.setenv("TTS_ALLOWED_ORIGINS", "*")
    with pytest.raises(ValueError):
        main.create_app()


def test_disconnect_cancels_upstream_and_releases_capacity(monkeypatch):
    async def scenario():
        started = asyncio.Event()
        disconnected = asyncio.Event()
        cancelled = asyncio.Event()

        class HeldCommunicate:
            def __init__(self, *_args, **_kwargs):
                pass

            async def stream(self):
                started.set()
                try:
                    await asyncio.Event().wait()
                    yield {"type": "audio", "data": b"never sent"}
                finally:
                    cancelled.set()

        monkeypatch.setattr(main.edge_tts, "Communicate", HeldCommunicate)
        application = main.create_app()
        body = json.dumps({"text": "Frase fictícia para cancelamento"}).encode()
        delivered_body = False
        messages = []

        async def receive():
            nonlocal delivered_body
            if not delivered_body:
                delivered_body = True
                return {"type": "http.request", "body": body, "more_body": False}
            await disconnected.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": "POST", "scheme": "http", "path": "/api/tts",
            "raw_path": b"/api/tts", "query_string": b"", "root_path": "",
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            "client": ("127.0.0.1", 12345), "server": ("127.0.0.1", 8000),
        }
        async with application.router.lifespan_context(application):
            request = asyncio.create_task(application(scope, receive, send))
            await asyncio.wait_for(started.wait(), timeout=1)
            disconnected.set()
            await asyncio.wait_for(request, timeout=1)
            assert cancelled.is_set()
            assert next(message["status"] for message in messages if message["type"] == "http.response.start") == 499
            assert b"".join(message.get("body", b"") for message in messages) == b""
            assert not application.state.audio_cache.entries
            slots = application.state.tts_slots
            for _ in range(main.MAX_CONCURRENT_REQUESTS):
                await asyncio.wait_for(slots.acquire(), timeout=0.1)
            for _ in range(main.MAX_CONCURRENT_REQUESTS):
                slots.release()

    asyncio.run(scenario())


def test_already_disconnected_request_does_not_start_provider(monkeypatch):
    class DisconnectedRequest:
        async def is_disconnected(self):
            return True

    def unexpected(*_args, **_kwargs):
        pytest.fail("An already disconnected client reached the provider")

    monkeypatch.setattr(main.edge_tts, "Communicate", unexpected)
    with pytest.raises(main.ClientDisconnected):
        asyncio.run(main.synthesize_for_request(main.TTSRequest(text="Frase fictícia"), DisconnectedRequest()))
