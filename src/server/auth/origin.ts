/** CSRF defense in depth: mutating requests must carry an Origin equal to APP_URL. */
export function originAllowed(origin: string | null, appUrl: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
