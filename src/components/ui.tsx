import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...args: Parameters<typeof clsx>) {
  return twMerge(clsx(...args));
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-border bg-surface p-6", className)} {...p} />;
}

export function Button({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-input bg-primary px-4 text-base font-semibold text-primary-fg disabled:opacity-60",
        className,
      )}
      {...p}
    />
  );
}

export function Field({
  label,
  error,
  id,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; id: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className="min-h-11 w-full rounded-input border border-border bg-surface px-3 text-base"
        {...p}
      />
      {error && (
        <p id={`${id}-err`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function AlertBox({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-input border border-danger p-3 text-sm text-danger">
      {children}
    </div>
  );
}
