/** Only the explicitly selected Vite demo mode enables simulated sign-in. */
export function isMockAuthMode(): boolean {
  return import.meta.env.MODE === "demo";
}
