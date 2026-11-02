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

beforeEach(() => {
  vi.resetModules();
  client.createClient.mockReset().mockReturnValue(client.instance);
  vi.stubEnv("VITE_SUPABASE_URL", VALID_URL);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", PUBLIC_TEST_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Supabase client: isolation of simulated authentication", () => {
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
    expect(configurationError).toContain("chave pública publishable");
    expect(client.createClient).not.toHaveBeenCalled();
  });
});
