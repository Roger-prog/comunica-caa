import { Login } from "./Login";

/** Kept for the existing public preview entry point. */
export function AuthPage({ onPreview }: { onPreview: () => void }) {
  return <Login onPreview={onPreview} />;
}
