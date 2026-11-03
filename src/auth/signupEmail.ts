export type EmailDomainStatus = "valid" | "invalid" | "unknown";

export async function lookupEmailDomain(
  domain: string,
): Promise<EmailDomainStatus> {
  try {
    const response = await fetch("/api/email-domain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(3_000),
    });
    if (response.ok) {
      const result: { status?: unknown } | null = await response.json();
      if (result?.status === "valid" || result?.status === "invalid") {
        return result.status;
      }
    }
  } catch {
    // A failed lookup is inconclusive. Supabase still requires the link.
  }
  return "unknown";
}

export class SignupEmailError extends Error {
  static from(cause: unknown): SignupEmailError | null {
    if (!cause || typeof cause !== "object" || !("code" in cause)) return null;
    if (cause.code === "email_address_invalid")
      return new SignupEmailError("Informe um e-mail válido.");
    if (cause.code === "email_address_not_authorized")
      return new SignupEmailError(
        "O serviço de envio do Comunica não aceita este endereço no momento.",
      );
    return null;
  }
}
