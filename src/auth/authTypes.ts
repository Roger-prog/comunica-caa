export type AccountRole = "responsavel" | "fonoaudiologo";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: AccountRole | null;
  emailConfirmed: boolean;
}

export function isAccountRole(value: unknown): value is AccountRole {
  return value === "responsavel" || value === "fonoaudiologo";
}
