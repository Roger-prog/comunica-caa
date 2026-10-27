"""Local async speech API. Run behind authentication/rate limits if published."""

import asyncio
import os
import time
from collections import OrderedDict
from contextlib import aclosing, asynccontextmanager
from typing import Callable, Literal
from urllib.parse import urlsplit

import edge_tts
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_BODY_BYTES = 16 * 1024
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MAX_CONCURRENT_REQUESTS = 2
SYNTHESIS_TIMEOUT_SECONDS = 25.0
QUEUE_TIMEOUT_SECONDS = 0.1
CACHE_MAX_ENTRIES = 128
CACHE_MAX_BYTES = 16 * 1024 * 1024
CACHE_TTL_SECONDS = 10 * 60.0
PRIVATE_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
DEFAULT_ORIGINS = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
)
Voice = Literal["pt-BR-FranciscaNeural", "pt-BR-AntonioNeural"]
CacheKey = tuple[str, str, int]


class TTSRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    text: str = Field(min_length=1, max_length=1000)
    voice: Voice = "pt-BR-FranciscaNeural"
    rate: float = Field(default=1.0, ge=0.5, le=1.5, allow_inf_nan=False)

    @field_validator("text", mode="before")
    @classmethod
    def normalize_text(cls, value):
        if not isinstance(value, str):
            return value
        if any((ord(char) < 32 and char not in "\t\r\n") or ord(char) == 127 for char in value):
            raise ValueError("invalid_control_character")
        return value.strip()


def rate_percent(payload: TTSRequest) -> int:
    """Use the exact same effective rate for synthesis and cache identity."""
    return round((payload.rate - 1.0) * 100)


def cache_key(payload: TTSRequest) -> CacheKey:
    return payload.text, payload.voice, rate_percent(payload)


class AudioCache:
    """Bounded process-local LRU; expired entries are removed on access/write.

    Methods contain no awaits and run on the application's event loop. Successful
    complete MP3 bytes are retained in RAM only; TTL is fixed, not sliding.
    """

    def __init__(
        self,
        max_entries: int = CACHE_MAX_ENTRIES,
        max_bytes: int = CACHE_MAX_BYTES,
        ttl_seconds: float = CACHE_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self.entries: OrderedDict[CacheKey, tuple[float, bytes]] = OrderedDict()
        self.size_bytes = 0

    def discard(self, key: CacheKey) -> None:
        entry = self.entries.pop(key, None)
        if entry is not None:
            self.size_bytes -= len(entry[1])

    def prune_expired(self) -> None:
        now = self.clock()
        for key, (expires_at, _audio) in tuple(self.entries.items()):
            if expires_at <= now:
                self.discard(key)

    def get(self, key: CacheKey) -> bytes | None:
        self.prune_expired()
        entry = self.entries.get(key)
        if entry is None:
            return None
        self.entries.move_to_end(key)
        return entry[1]

    def put(self, key: CacheKey, audio: bytes) -> None:
        self.prune_expired()
        self.discard(key)
        if not audio or len(audio) > self.max_bytes or self.max_entries <= 0:
            return
        self.entries[key] = (self.clock() + self.ttl_seconds, audio)
        self.size_bytes += len(audio)
        while len(self.entries) > self.max_entries or self.size_bytes > self.max_bytes:
            oldest = next(iter(self.entries))
            self.discard(oldest)

    def clear(self) -> None:
        self.entries.clear()
        self.size_bytes = 0


def allowed_origins() -> tuple[str, ...]:
    configured = os.getenv("TTS_ALLOWED_ORIGINS")
    if configured is None:
        return DEFAULT_ORIGINS
    origins = tuple(dict.fromkeys(item.strip().rstrip("/") for item in configured.split(",") if item.strip()))
    if not origins:
        raise ValueError("TTS_ALLOWED_ORIGINS must contain an explicit origin.")
    for origin in origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
            or "*" in origin
        ):
            raise ValueError("TTS_ALLOWED_ORIGINS must contain exact HTTP(S) origins.")
        try:
            parsed.port
        except ValueError as error:
            raise ValueError("Invalid origin port.") from error
    return origins


class RequestLimitsMiddleware:
    """Bounds a TTS body before JSON parsing, including chunked HTTP requests."""

    def __init__(self, app, origins: tuple[str, ...]):
        self.app = app
        self.origins = frozenset(origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") != "POST" or scope.get("path") != "/api/tts":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        origin = headers.get(b"origin")
        # An origin allowlist is an extra browser boundary, not authentication.
        if origin and origin.decode("latin-1") not in self.origins:
            await JSONResponse({"detail": "Origem não permitida."}, status_code=403, headers=PRIVATE_HEADERS)(scope, receive, send)
            return
        length = headers.get(b"content-length")
        if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
            await self.too_large(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_BODY_BYTES:
                await self.too_large(scope, receive, send)
                return
            if not message.get("more_body", False):
                break
        replayed = False

        async def replay_receive():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay_receive, send)

    @staticmethod
    async def too_large(scope, receive, send):
        await JSONResponse({"detail": "Pedido de áudio muito grande."}, status_code=413, headers=PRIVATE_HEADERS)(scope, receive, send)


async def synthesize(payload: TTSRequest) -> bytes:
    communicate = edge_tts.Communicate(payload.text, payload.voice, rate=f"{rate_percent(payload):+d}%")
    audio = bytearray()
    async with aclosing(communicate.stream()) as stream:
        async for chunk in stream:
            if chunk.get("type") != "audio":
                continue
            data = chunk.get("data")
            if not isinstance(data, bytes):
                raise ValueError("invalid_audio")
            if len(audio) + len(data) > MAX_AUDIO_BYTES:
                raise ValueError("audio_limit")
            audio.extend(data)
    if not audio:
        raise ValueError("empty_audio")
    return bytes(audio)


class ClientDisconnected(Exception):
    """The caller no longer needs speech; never return partial/private audio."""


async def wait_for_disconnect(request: Request, stop: asyncio.Event) -> None:
    while not stop.is_set():
        if await request.is_disconnected():
            return
        try:
            await asyncio.wait_for(stop.wait(), timeout=0.05)
        except asyncio.TimeoutError:
            pass


async def synthesize_for_request(payload: TTSRequest, request: Request) -> bytes:
    if await request.is_disconnected():
        raise ClientDisconnected
    stop = asyncio.Event()
    synthesis = asyncio.create_task(synthesize(payload))
    disconnect = asyncio.create_task(wait_for_disconnect(request, stop))
    try:
        completed, _ = await asyncio.wait(
            (synthesis, disconnect),
            timeout=SYNTHESIS_TIMEOUT_SECONDS,
            return_when=asyncio.FIRST_COMPLETED,
        )
        if disconnect in completed:
            disconnect.result()
            raise ClientDisconnected
        if synthesis in completed:
            return synthesis.result()
        raise asyncio.TimeoutError
    finally:
        # Starlette's disconnect check uses a cancellation scope; the explicit
        # stop event also terminates the watcher if that scope absorbs cancel().
        stop.set()
        for task in (synthesis, disconnect):
            if not task.done():
                task.cancel()
        # Await cancellation so edge-tts closes its websocket before releasing
        # the concurrency slot or starting another sentence.
        await asyncio.gather(synthesis, disconnect, return_exceptions=True)


def create_app() -> FastAPI:
    origins = allowed_origins()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.tts_slots = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        application.state.audio_cache = AudioCache()
        try:
            yield
        finally:
            application.state.audio_cache.clear()

    application = FastAPI(title="Comunica TTS", version="1.0.0", lifespan=lifespan)
    application.add_middleware(RequestLimitsMiddleware, origins=origins)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @application.exception_handler(RequestValidationError)
    async def invalid_payload(_request, _error):
        # Do not echo supplied sentences in error payloads or diagnostics.
        return JSONResponse({"detail": "Dados de síntese inválidos."}, status_code=422, headers=PRIVATE_HEADERS)

    @application.get("/health")
    async def health():
        return JSONResponse({"status": "ok"}, headers=PRIVATE_HEADERS)

    @application.post("/api/tts", response_class=Response, responses={200: {"content": {"audio/mpeg": {}}}})
    async def tts(payload: TTSRequest, request: Request):
        cache = application.state.audio_cache
        key = cache_key(payload)
        cached_audio = cache.get(key)
        if cached_audio is not None:
            return audio_response(cached_audio)
        slots = application.state.tts_slots
        try:
            await asyncio.wait_for(slots.acquire(), timeout=QUEUE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError as error:
            raise HTTPException(status_code=503, detail="Serviço de voz ocupado. Tente novamente.", headers={**PRIVATE_HEADERS, "Retry-After": "1"}) from error
        try:
            # Another request may have populated the cache while we awaited a slot.
            audio = cache.get(key)
            if audio is None:
                audio = await synthesize_for_request(payload, request)
                cache.put(key, audio)
        except ClientDisconnected:
            return Response(status_code=499, headers=PRIVATE_HEADERS)
        except asyncio.TimeoutError as error:
            raise HTTPException(status_code=504, detail="O serviço de voz demorou a responder.", headers=PRIVATE_HEADERS) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail="Não foi possível gerar o áudio.", headers=PRIVATE_HEADERS) from error
        finally:
            slots.release()
        return audio_response(audio)

    return application


def audio_response(audio: bytes) -> Response:
    # A bytes response supplies Content-Length and avoids a second HTTP download.
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={**PRIVATE_HEADERS, "Content-Disposition": 'inline; filename="fala.mp3"'},
    )


app = create_app()
