"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertBox, Button, Card, Field } from "./ui";

type Role = "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER";
const ROLE_LABEL: Record<Role, string> = { CUSTOMER: "Customer", DISTRIBUTOR: "Distributor", PROVIDER: "Provider" };

export function RegisterForm() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("CUSTOMER");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const staff = role !== "CUSTOMER";

  async function post(path: string, payload: unknown) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    const payload = {
      name: get("name"),
      email: get("email"),
      password: get("password"),
      phone: get("phone"),
      role,
      ...(staff ? { businessName: get("businessName"), city: get("city") } : {}),
    };
    try {
      const res = await post("/api/auth/register", payload);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.code === "VALIDATION" && body.fields) setFields(body.fields);
        else if (body?.code === "RATE_LIMITED" || body?.code === "EMAIL_TAKEN") setError(body.error);
        else setError("Registration failed, please retry");
        return;
      }
      const login = await post("/api/auth/login", { email: payload.email, password: payload.password });
      const lb = await login.json().catch(() => null);
      router.replace(login.ok && lb?.data?.redirectTo ? lb.data.redirectTo : "/login");
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">Create account</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <AlertBox>{error}</AlertBox>}
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">I am a</legend>
          <div className="flex gap-4" role="radiogroup">
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-2 text-base">
                <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
                {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
          {staff && <p className="text-sm text-muted">Needs admin approval before you can use the app.</p>}
        </fieldset>
        <Field id="name" label="Name" autoComplete="name" required error={fields.name} />
        <Field id="email" label="Email" type="email" autoComplete="email" required error={fields.email} />
        <Field id="password" label="Password" type="password" autoComplete="new-password" required error={fields.password} />
        <Field id="phone" label="Phone" type="tel" autoComplete="tel" required error={fields.phone} />
        {staff && (
          <>
            <Field id="businessName" label="Business name" required error={fields.businessName} />
            <Field id="city" label="City" required error={fields.city} />
          </>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Creating..." : "Create account"}
        </Button>
      </form>
      <p className="text-sm text-muted">
        Have an account?{" "}
        <Link href="/login" className="font-semibold text-primary underline">
          Log in
        </Link>
      </p>
    </Card>
  );
}
