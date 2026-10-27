/** This session-only PIN is a UI guard, independent from account authentication. */
export interface PinVerifier {
  salt: ArrayBuffer;
  digest: ArrayBuffer;
}

export function isValidPin(pin: string): boolean {
  return /^[0-9]{4,6}$/.test(pin);
}

async function derive(pin: string, salt: ArrayBuffer): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 120_000, hash: "SHA-256" },
    key,
    256,
  );
}

export async function createPinVerifier(pin: string): Promise<PinVerifier> {
  if (!isValidPin(pin)) throw new Error("invalid_pin");
  if (!globalThis.crypto?.subtle) throw new Error("pin_unavailable");
  const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;
  return { salt, digest: await derive(pin, salt) };
}

export async function verifyPin(
  pin: string,
  verifier: PinVerifier,
): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  const candidate = new Uint8Array(await derive(pin, verifier.salt));
  const expected = new Uint8Array(verifier.digest);
  let difference = candidate.length ^ expected.length;
  for (let index = 0; index < expected.length; index++) {
    difference |= candidate[index] ^ expected[index];
  }
  return difference === 0;
}
