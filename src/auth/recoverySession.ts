import type { Session } from "@supabase/supabase-js";

export const RECOVERY_STORAGE_KEY = "comunica-password-recovery-v1";
export const RECOVERY_TTL_MS = 15 * 60 * 1000;
type RecoveryMarker = { version: 1; userId: string; expiresAt: number };
let memoryMarker: RecoveryMarker | null = null;

export function clearRecoverySession() {
  memoryMarker = null;
  try {
    sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
  } catch {
    /* Recovery remains usable in memory when browser storage is blocked. */
  }
}

/** Call only in response to the SDK's verified PASSWORD_RECOVERY event. */
export function recordRecoverySession(session: Session): RecoveryMarker {
  const marker: RecoveryMarker = {
    version: 1,
    userId: session.user.id,
    expiresAt: Date.now() + RECOVERY_TTL_MS,
  };
  memoryMarker = marker;
  try {
    sessionStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    /* A reload requires opening the email link again if storage is blocked. */
  }
  return marker;
}

export function readRecoverySession(userId: string): RecoveryMarker | null {
  let value: unknown;
  try {
    value = JSON.parse(sessionStorage.getItem(RECOVERY_STORAGE_KEY) ?? "null");
  } catch {
    value = memoryMarker;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const marker = value as Partial<RecoveryMarker>;
    if (
      marker.version === 1 &&
      marker.userId === userId &&
      typeof marker.expiresAt === "number" &&
      Number.isFinite(marker.expiresAt) &&
      marker.expiresAt > Date.now() &&
      marker.expiresAt <= Date.now() + RECOVERY_TTL_MS
    ) {
      return marker as RecoveryMarker;
    }
  }
  clearRecoverySession();
  return null;
}
