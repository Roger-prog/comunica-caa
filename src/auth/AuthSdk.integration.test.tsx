import { cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";

// Only the configured-client boundary is replaced. Every Auth and PostgREST
// method, PKCE exchange, storage write and SDK event below uses the real SDK.
const injected = vi.hoisted(() => ({
  client: null as SupabaseClient<Database> | null,
}));
vi.mock("../lib/supabase", () => ({
  configurationError: null,
  get supabase() {
    return injected.client;
  },
}));

const OLD_USER_ID = "11111111-1111-4111-8111-111111111111";
const NEW_USER_ID = "22222222-2222-4222-8222-222222222222";
const FIXTURE_VERIFIER =
  "sdk-test-verifier-with-no-real-authentication-secrets";
const API_ORIGIN = "https://sdk-auth.example.test";
let fixtureNumber = 0;
const teardown: Array<() => Promise<void> | void> = [];

function fixtureSession(id: string): Session {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: id,
    aud: "authenticated",
    role: "authenticated",
    exp: now + 3600,
    iat: now,
  })}.synthetic-test-signature`;
  return {
    access_token: accessToken,
    refresh_token: `synthetic-test-refresh-${id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id,
      email: `${id}@example.test`,
      aud: "authenticated",
      role: "authenticated",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { nome: "Untrusted provider name", role: "admin" },
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Supabase-Api-Version": "2024-01-01",
    },
  });
}

function createFixture(options: {
  verifier?: "sign-in" | "recovery";
  failExchange?: boolean;
  previousSession?: boolean;
  path?: string;
}) {
  fixtureNumber++;
  const storageKey = `comunica-sdk-integration-${fixtureNumber}`;
  const oldSession = fixtureSession(OLD_USER_ID);
  const newSession = fixtureSession(NEW_USER_ID);
  const users = new Map<string, User>([
    [oldSession.access_token, oldSession.user],
    [newSession.access_token, newSession.user],
  ]);
  if (options.previousSession)
    localStorage.setItem(storageKey, JSON.stringify(oldSession));
  if (options.verifier)
    localStorage.setItem(
      `${storageKey}-code-verifier`,
      JSON.stringify(
        `${FIXTURE_VERIFIER}${options.verifier === "recovery" ? "/recovery" : ""}`,
      ),
    );
  window.history.replaceState(
    {},
    "",
    options.path ?? "/auth/callback?code=synthetic-single-use-code",
  );
  const gate = deferred();
  const exchangeBodies: unknown[] = [];
  const requests: string[] = [];
  const events: AuthChangeEvent[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.origin !== API_ORIGIN)
      throw new Error("An unexpected external destination was requested.");
    if (
      url.pathname === "/auth/v1/token" &&
      url.searchParams.get("grant_type") === "pkce"
    ) {
      exchangeBodies.push(JSON.parse(String(init?.body)));
      await gate.promise;
      return options.failExchange
        ? jsonResponse(
            {
              code: "flow_state_expired",
              message: "PRIVATE_TEST_PKCE_DIAGNOSTIC",
            },
            400,
          )
        : jsonResponse(newSession);
    }
    if (url.pathname === "/auth/v1/user") {
      const token = new Headers(init?.headers)
        .get("Authorization")
        ?.replace(/^Bearer /, "");
      const user = token ? users.get(token) : null;
      return user
        ? jsonResponse(user)
        : jsonResponse({ code: "bad_jwt", message: "Invalid test token" }, 401);
    }
    if (url.pathname === "/rest/v1/caa_profiles") {
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      return jsonResponse({
        id,
        nome:
          id === NEW_USER_ID ? "Nome canônico novo" : "Nome canônico anterior",
        role: id === NEW_USER_ID ? "fonoaudiologo" : "responsavel",
      });
    }
    throw new Error(`Unexpected fixture API path: ${url.pathname}`);
  };
  const client = createClient<Database>(
    API_ORIGIN,
    "sb_publishable_synthetic_test_only",
    {
      auth: {
        storage: localStorage,
        storageKey,
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
      global: { fetch: fakeFetch },
    },
  );
  injected.client = client;
  const subscription = client.auth.onAuthStateChange((event) => {
    events.push(event);
  }).data.subscription;
  teardown.push(async () => {
    gate.resolve();
    await client.auth.initialize();
    subscription.unsubscribe();
    await client.auth.stopAutoRefresh();
    await client.removeAllChannels();
  });
  return { client, gate, requests, events, exchangeBodies, storageKey };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("MODE", "production");
  // Per-test clients must not communicate over Node's BroadcastChannel.
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.clear();
  sessionStorage.clear();
  injected.client = null;
});

afterEach(async () => {
  cleanup();
  for (const release of teardown.splice(0)) await release();
  injected.client = null;
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AuthProvider with the actual Supabase SDK: PKCE callback boundaries", () => {
  it("fails closed when a code has no local verifier even though the SDK restores an older session", async () => {
    const fixture = createFixture({ previousSession: true });
    const { AuthProvider, useAuth } = await import("./AuthProvider");
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((await fixture.client.auth.getSession()).data.session?.user.id).toBe(
      OLD_USER_ID,
    );
    expect(fixture.exchangeBodies).toEqual([]);
    expect(new URLSearchParams(window.location.search).has("code")).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.isRecovery).toBe(false);
    expect(result.current.error).toContain("inválido ou expirou");
  });

  it("rejects a failed real PKCE exchange without releasing the SDK's previous INITIAL_SESSION", async () => {
    const fixture = createFixture({
      previousSession: true,
      verifier: "sign-in",
      failExchange: true,
    });
    const { AuthProvider, useAuth } = await import("./AuthProvider");
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(fixture.exchangeBodies).toHaveLength(1));
    expect(result.current.loading).toBe(true);
    fixture.gate.resolve();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(fixture.events).toContain("INITIAL_SESSION"));
    expect((await fixture.client.auth.getSession()).data.session?.user.id).toBe(
      OLD_USER_ID,
    );
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.error).toContain("inválido ou expirou");
    expect(result.current.error).not.toContain("PRIVATE_TEST_PKCE_DIAGNOSTIC");
    expect(
      localStorage.getItem(`${fixture.storageKey}-code-verifier`),
    ).toBeNull();
  });

  it("consumes a valid code and opens the new user's canonical profile instead of the stored account", async () => {
    const fixture = createFixture({
      previousSession: true,
      verifier: "sign-in",
    });
    const { AuthProvider, useAuth } = await import("./AuthProvider");
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(fixture.exchangeBodies).toHaveLength(1));
    fixture.gate.resolve();
    await waitFor(() => expect(result.current.user?.id).toBe(NEW_USER_ID));
    expect(result.current.loading).toBe(false);
    expect(result.current.user?.name).toBe("Nome canônico novo");
    expect(result.current.user?.role).toBe("fonoaudiologo");
    expect(result.current.error).toBeNull();
    expect(result.current.isRecovery).toBe(false);
    expect(new URLSearchParams(window.location.search).has("code")).toBe(false);
    expect(fixture.exchangeBodies).toEqual([
      {
        auth_code: "synthetic-single-use-code",
        code_verifier: FIXTURE_VERIFIER,
      },
    ]);
    expect(
      fixture.requests.some((request) =>
        request.includes("/rest/v1/caa_profiles"),
      ),
    ).toBe(true);
  });

  it("records the SDK's verified PASSWORD_RECOVERY before React mounts and restores the recovery flow", async () => {
    const fixture = createFixture({
      previousSession: true,
      verifier: "recovery",
      path: "/redefinir-senha?code=synthetic-single-use-code",
    });
    const { AuthProvider, useAuth } = await import("./AuthProvider");
    const { RECOVERY_STORAGE_KEY } = await import("./recoverySession");
    await waitFor(() => expect(fixture.exchangeBodies).toHaveLength(1));
    fixture.gate.resolve();
    await waitFor(() => expect(fixture.events).toContain("PASSWORD_RECOVERY"));
    expect(
      JSON.parse(sessionStorage.getItem(RECOVERY_STORAGE_KEY)!),
    ).toMatchObject({
      version: 1,
      userId: NEW_USER_ID,
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.id).toBe(NEW_USER_ID);
    expect(result.current.isRecovery).toBe(true);
    expect(result.current.error).toBeNull();
    expect(new URLSearchParams(window.location.search).has("code")).toBe(false);
    expect(fixture.exchangeBodies).toEqual([
      {
        auth_code: "synthetic-single-use-code",
        code_verifier: FIXTURE_VERIFIER,
      },
    ]);
  });
});
