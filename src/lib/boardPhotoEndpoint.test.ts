import { afterEach, describe, expect, it, vi } from "vitest";
import { boardPhotoResponse } from "../../api/board-photo";

const patientId = "00000000-0000-4000-8000-000000000101";
const path = patientId + "/00000000-0000-4000-8000-000000000102";
const authorization = "Bearer synthetic.caller.jwt.value";
const env = {
  VITE_SUPABASE_URL: "https://supabase.example.test",
  VITE_SUPABASE_PUBLISHABLE_KEY: "synthetic_public_value",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic_server_value",
};
function request(photoPath = path, auth: string | null = authorization) {
  return new Request("https://app.example.test/api/board-photo", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify({ path: photoPath }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("entrega de fotos privadas da prancha", () => {
  it("blocks a request after the membership is revoked without reaching Storage", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ image_path: path }]))
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])))
      .mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal("fetch", fetcher);

    const firstResponse = await boardPhotoResponse(request(), env);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(firstResponse.headers.get("content-type")).toBe("image/jpeg");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(authorization);
    expect(fetcher.mock.calls[0][0].searchParams.get("crianca_id")).toBe("eq." + patientId);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer synthetic_server_value");
    expect((await boardPhotoResponse(request(), env)).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects missing sessions, invalid paths and another patient's image", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ image_path: "other" }]));
    vi.stubGlobal("fetch", fetcher);
    expect((await boardPhotoResponse(request(path, null), env)).status).toBe(401);
    expect((await boardPhotoResponse(request("../profile.png"), env)).status).toBe(400);
    expect((await boardPhotoResponse(request(), env)).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never returns an active document as an image and fails closed on connectivity errors", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ image_path: path }]))
      .mockResolvedValueOnce(new Response("<svg xmlns='http://www.w3.org/2000/svg'/>"))
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetcher);
    expect((await boardPhotoResponse(request(), env)).status).toBe(502);
    expect((await boardPhotoResponse(request(), env)).status).toBe(502);
  });
});
