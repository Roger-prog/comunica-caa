import { describe, expect, it, vi } from "vitest";
import {
  assertPasswordUpdateToken,
  withPasswordUpdateToken,
} from "./passwordMutation";

const url = "https://example.supabase.co/auth/v1/user";

describe("Password update session binding", () => {
  it("permits the original token at the final transport boundary", async () => {
    await expect(
      withPasswordUpdateToken("fixture-a", async () => {
        assertPasswordUpdateToken(url, {
          method: "PUT",
          headers: { Authorization: "Bearer fixture-a" },
        });
        return "updated";
      }),
    ).resolves.toBe("updated");
  });

  it("rejects a different account or refreshed token before sending credentials", async () => {
    const send = vi.fn();
    await expect(
      withPasswordUpdateToken("fixture-a", async () => {
        assertPasswordUpdateToken(url, {
          method: "PUT",
          headers: new Headers({ authorization: "Bearer fixture-b" }),
        });
        send();
      }),
    ).rejects.toMatchObject({ code: "session_changed" });
    expect(send).not.toHaveBeenCalled();
  });

  it("checks Request instances and refuses missing authorization", async () => {
    await expect(
      withPasswordUpdateToken("fixture-a", async () => {
        assertPasswordUpdateToken(new Request(url, { method: "PUT" }));
      }),
    ).rejects.toMatchObject({ code: "session_changed" });
  });

  it("releases the guard after failure and leaves unrelated requests untouched", async () => {
    await expect(
      withPasswordUpdateToken("fixture-a", async () => {
        throw new Error("fixture failure");
      }),
    ).rejects.toThrow("fixture failure");
    assertPasswordUpdateToken(url, { method: "PUT" });
    await withPasswordUpdateToken("fixture-b", async () => {
      assertPasswordUpdateToken(
        "https://example.supabase.co/rest/v1/caa_profiles",
        { method: "PATCH" },
      );
      assertPasswordUpdateToken(url, { method: "GET" });
      assertPasswordUpdateToken(url, {
        method: "PUT",
        headers: [["authorization", "Bearer fixture-b"]],
      });
    });
  });

  it("does not let overlapping password operations replace an active intent", async () => {
    await withPasswordUpdateToken("fixture-a", async () => {
      await expect(
        withPasswordUpdateToken("fixture-b", async () => {}),
      ).rejects.toMatchObject({ code: "session_changed" });
      assertPasswordUpdateToken(url, {
        method: "PUT",
        headers: { authorization: "Bearer fixture-a" },
      });
    });
  });
});
