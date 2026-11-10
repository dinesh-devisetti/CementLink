"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertBox, Button, Card, Field } from "./ui";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data?.redirectTo) {
        const code = body?.code;
        setError(
          code === "RATE_LIMITED"
            ? (body?.error ?? "Too many attempts, try again later")
            : code === "BAD_CREDENTIALS"
              ? "Email or password is wrong"
              : code === "VALIDATION"
                ? "Enter a valid email and password"
                : "Something went wrong, please retry",
        );
        return;
      }
      router.replace(body.data.redirectTo);
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">CementLink</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <AlertBox>{error}</AlertBox>}
        <Field id="email" label="Email" type="email" autoComplete="email" required />
        <Field id="password" label="Password" type="password" autoComplete="current-password" required />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Logging in..." : "Log in"}
        </Button>
      </form>
      <p className="text-sm text-muted">
        New here?{" "}
        <Link href="/register" className="font-semibold text-primary underline">
          Register
        </Link>
      </p>
    </Card>
  );
}
