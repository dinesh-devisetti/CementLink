/** Tiny fetch wrapper for client components: returns the server's message instead of throwing. */
export async function sendJson(url: string, method: "POST" | "PATCH", body?: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: j?.error ?? "Something went wrong, please retry" };
  } catch {
    return { ok: false, error: "Network error, please retry" };
  }
}
