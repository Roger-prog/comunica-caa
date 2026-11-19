import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";
import type { AccountRole, AuthUser } from "./authTypes";

export type SignUpResult = "signed-in" | "confirmation-required";

export interface AuthContextValue {
  user: AuthUser | null;
  isMock: boolean;
  session: Session | null;
  loading: boolean;
  error: string | null;
  isRecovery: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    nome: string,
    email: string,
    password: string,
    consent: boolean,
    role: AccountRole,
  ) => Promise<SignUpResult>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  completeProfile: (
    role: AccountRole,
    nome: string,
    consent: boolean,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  retrySession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value)
    throw new Error("useAuth deve ser utilizado dentro de AuthProvider.");
  return value;
}
