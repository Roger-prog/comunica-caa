import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  createClient: vi.fn(),
  instance: { marker: "test-only-client" },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: client.createClient,
}));

const VALID_URL = "https://project.example.test";
const PUBLIC_TEST_KEY = "sb_publishable_test_only_not_a_real_key";

function legacyKey(payload: unknown): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.synthetic-test-signature`;
}

function diagnostics(): string {
  return JSON.stringify(
    [
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ],
    (_name, value) =>
      value instanceof Error
        ? { ...value, message: value.message, stack: value.stack }
        : value,
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  client.createClient.mockReset().mockReturnValue(client.instance);
  vi.stubEnv("MODE", "production");
  vi.stubEnv("VITE_SUPABASE_URL", VALID_URL);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", PUBLIC_TEST_KEY);
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Supabase client: public environment configuration and demo isolation", () => {
  it("blocks a password request for a switched session before the network transport", async () => {
    vi.stubEnv("MODE", "production");
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    await import("./supabase");
    const options = client.createClient.mock.calls[0][2] as {
      global: { fetch: typeof fetch };
    };
    const { withPasswordUpdateToken } =
      await import("../auth/passwordMutation");
    await expect(
      withPasswordUpdateToken("fixture-account-a", () =>
        options.global.fetch(`${VALID_URL}/auth/v1/user`, {
          method: "PUT",
          headers: { authorization: "Bearer fixture-account-b" },
          body: JSON.stringify({ password: "ficticia-123456" }),
        }),
      ),
    ).rejects.toMatchObject({ code: "session_changed" });
    expect(network).not.toHaveBeenCalled();
  });
  it("never creates a Supabase client in demo mode even with valid configuration", async () => {
    vi.stubEnv("MODE", "demo");
    const { supabase, configurationError } = await import("./supabase");

    expect(supabase).toBeNull();
    expect(configurationError).toBeNull();
    expect(client.createClient).not.toHaveBeenCalled();
  });

  it("does not require or expose Supabase configuration errors for the demo", async () => {
    vi.stubEnv("MODE", "demo");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    const { supabase, configurationError } = await import("./supabase");

    expect(supabase).toBeNull();
    expect(configurationError).toBeNull();
    expect(client.createClient).not.toHaveBeenCalled();
  });

  it("creates the real-mode client in production with valid public configuration", async () => {
    vi.stubEnv("MODE", "production");
    const { supabase, configurationError } = await import("./supabase");

    expect(configurationError).toBeNull();
    expect(supabase).toBe(client.instance);
    expect(client.createClient).toHaveBeenCalledExactlyOnceWith(
      VALID_URL,
      PUBLIC_TEST_KEY,
      expect.objectContaining({
        auth: expect.objectContaining({
          persistSession: true,
          autoRefreshToken: true,
          flowType: "pkce",
          storageKey: "comunica-react-auth",
        }),
        global: { fetch: expect.any(Function) },
      }),
    );
  });

  it("keeps real-mode validation active instead of falling back to a mock client", async () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "invalid-test-key");
    const { supabase, configurationError } = await import("./supabase");

    expect(supabase).toBeNull();
    expect(configurationError).toEqual(expect.any(String));
    expect(configurationError).not.toBe("");
    expect(client.createClient).not.toHaveBeenCalled();
  });

  it("accepts the ANON variable used by Vercel when it contains a publishable key", async () => {
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", PUBLIC_TEST_KEY);
    const { supabase, configurationError } = await import("./supabase");

    expect(configurationError).toBeNull();
    expect(supabase).toBe(client.instance);
    expect(client.createClient).toHaveBeenCalledExactlyOnceWith(
      VALID_URL,
      PUBLIC_TEST_KEY,
      expect.any(Object),
    );
  });

  it("supports a legacy anon JWT through the ANON variable", async () => {
    const anon = legacyKey({ role: "anon", iss: "fixture-issuer" });
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", anon);
    const { supabase, configurationError } = await import("./supabase");

    expect(configurationError).toBeNull();
    expect(supabase).toBe(client.instance);
    expect(client.createClient).toHaveBeenCalledExactlyOnceWith(
      VALID_URL,
      anon,
      expect.any(Object),
    );
    expect(diagnostics()).not.toContain(anon);
    expect(diagnostics()).not.toContain("fixture-issuer");
  });

  it("prefers the explicit publishable variable and does not log the unused legacy value", async () => {
    const ignored = legacyKey({
      role: "service_role",
      issuer: "ignored-private-fixture",
    });
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", ignored);
    const { configurationError } = await import("./supabase");

    expect(configurationError).toBeNull();
    expect(client.createClient.mock.calls[0][1]).toBe(PUBLIC_TEST_KEY);
    expect(diagnostics()).not.toContain(ignored);
    expect(diagnostics()).not.toContain("ignored-private-fixture");
  });

  it("does not hide a populated invalid publishable configuration behind a valid ANON fallback", async () => {
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "invalid-test-key");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", legacyKey({ role: "anon" }));
    const { supabase, configurationError } = await import("./supabase");

    expect(supabase).toBeNull();
    expect(configurationError).toEqual(expect.any(String));
    expect(client.createClient).not.toHaveBeenCalled();
  });

  it("trims environment values before selecting the fallback and constructing the client", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", `  ${VALID_URL}\n`);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", " \t ");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", `\n${PUBLIC_TEST_KEY}  `);
    const { configurationError } = await import("./supabase");

    expect(configurationError).toBeNull();
    expect(client.createClient).toHaveBeenCalledExactlyOnceWith(
      VALID_URL,
      PUBLIC_TEST_KEY,
      expect.any(Object),
    );
  });

  it.each([
    ["secret", "sb_secret_synthetic_private_test_value"],
    ["service role", legacyKey({ role: "service_role" })],
    ["authenticated role", legacyKey({ role: "authenticated" })],
    ["missing role", legacyKey({ issuer: "fixture" })],
    ["non-string role", legacyKey({ role: ["anon"] })],
    ["non-object payload", legacyKey("anon")],
    ["malformed JWT", "e30.not-valid-base64-or-json.synthetic"],
  ])(
    "rejects %s credentials in either public environment variable",
    async (_kind, rejected) => {
      for (const keyName of [
        "VITE_SUPABASE_PUBLISHABLE_KEY",
        "VITE_SUPABASE_ANON_KEY",
      ]) {
        vi.resetModules();
        client.createClient.mockClear();
        vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
        vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
        vi.stubEnv(keyName, rejected);
        const { supabase, configurationError } = await import("./supabase");
        expect(supabase).toBeNull();
        expect(configurationError).toEqual(expect.any(String));
        expect(client.createClient).not.toHaveBeenCalled();
        expect(diagnostics()).not.toContain(rejected);
      }
    },
  );

  it("reports missing build configuration without exposing values in diagnostics", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const { supabase, configurationError } = await import("./supabase");

    expect(supabase).toBeNull();
    expect(configurationError).toEqual(expect.any(String));
    expect(client.createClient).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
    expect(diagnostics()).not.toContain(PUBLIC_TEST_KEY);
  });

  it("keeps the real client disabled when neither public key variable is configured", async () => {
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { supabase, configurationError } = await import("./supabase");
    expect(supabase).toBeNull();
    expect(configurationError).toEqual(expect.any(String));
    expect(client.createClient).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it.each(["http://project.example.test", "not-a-valid-url"])(
    "rejects an invalid Supabase URL without passing it to the SDK: %s",
    async (url) => {
      vi.stubEnv("VITE_SUPABASE_URL", url);
      const { supabase, configurationError } = await import("./supabase");
      expect(supabase).toBeNull();
      expect(configurationError).toEqual(expect.any(String));
      expect(client.createClient).not.toHaveBeenCalled();
      expect(diagnostics()).not.toContain(url);
    },
  );

  it("logs startup state without printing the URL, key or decoded token payload", async () => {
    await import("./supabase");
    expect(console.log).toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(diagnostics()).not.toContain(VALID_URL);
    expect(diagnostics()).not.toContain("project.example.test");
    expect(diagnostics()).not.toContain(PUBLIC_TEST_KEY);
  });

  it("contains SDK construction failures without logging the original exception", async () => {
    const privateDetail = `private-diagnostic-fixture ${VALID_URL} ${PUBLIC_TEST_KEY}`;
    client.createClient.mockImplementation(() => {
      throw new Error(privateDetail);
    });
    const result = await import("./supabase");

    expect(result.supabase).toBeNull();
    expect(result.configurationError).toEqual(expect.any(String));
    expect(result.configurationError).not.toContain(
      "private-diagnostic-fixture",
    );
    expect(console.error).toHaveBeenCalled();
    expect(diagnostics()).not.toContain(privateDetail);
    expect(diagnostics()).not.toContain(PUBLIC_TEST_KEY);
    expect(diagnostics()).not.toContain(VALID_URL);
  });
});
