type PasswordIntent = { token: string };
let activeIntent: PasswordIntent | null = null;

class SessionChangedError extends Error {
  readonly code = "session_changed";
  constructor() {
    super(
      "Sua sessão mudou. Abra novamente o link de recuperação para continuar.",
    );
    this.name = "SessionChangedError";
  }
}

/** Bind the SDK password update to the session that opened the reset form. */
export async function withPasswordUpdateToken<T>(
  token: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!token || activeIntent) throw new SessionChangedError();
  const intent = { token };
  activeIntent = intent;
  try {
    return await operation();
  } finally {
    if (activeIntent === intent) activeIntent = null;
  }
}

/** Check the final SDK request, after it has resolved its current session. */
export function assertPasswordUpdateToken(
  input: RequestInfo | URL,
  init?: RequestInit,
): void {
  if (!activeIntent) return;
  const request =
    typeof Request !== "undefined" && input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const url = new URL(request?.url ?? input.toString());
  if (method !== "PUT" || !url.pathname.endsWith("/auth/v1/user")) return;
  const headers = new Headers(init?.headers ?? request?.headers);
  if (headers.get("authorization") !== `Bearer ${activeIntent.token}`)
    throw new SessionChangedError();
}
