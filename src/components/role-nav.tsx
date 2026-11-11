"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrent, type NavItem } from "@/lib/nav";
import { cn } from "./ui";

/** Role tabs as real links; aria-current="page" follows the route. */
export function RoleNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Sections" className="flex gap-2 overflow-x-auto">
      {items.map((item) => {
        const current = isCurrent(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center whitespace-nowrap rounded-input border border-border px-3 text-sm font-semibold",
              current ? "bg-primary text-primary-fg" : "text-muted hover:text-text",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
