"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LINKS_PAGE_SIZE } from "@/lib/constants";
import type { LinkKind } from "@/server/db/schema";
import type { DirectoryRow } from "@/server/services/directory";
import type { LinkRow } from "@/server/services/links";
import { LinkStatusBadge } from "./link-status-badge";
import { Button } from "./ui";

const DIRECTORY_PAGE_SIZE = 20;

export interface DirectoryConfig {
  url: string;
  findLabel: string;
}

const place = (city: string | null) => (city ? `, ${city}` : "");
const ghost = "border border-border bg-transparent text-text";
type Errors = Record<string, string>;
type Act = (key: string, path: string, body?: unknown) => Promise<boolean>;

async function post(path: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return null;
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    return j?.error ?? "Request failed, please retry";
  } catch {
    return "Network error, please retry";
  }
}

function RowError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null;
}

/**
 * One panel for all four link tabs. Lower-tier tabs pass `directory` (Find ... sheet, Request link);
 * upper-tier tabs get Approve / Reject on incoming requests. Both sides can revoke an active link.
 * The server sends page 1 (incoming requests first); "Load more" fetches the rest.
 */
export function LinksPanel({
  links,
  total,
  kind,
  directory,
  emptyText,
}: {
  links: LinkRow[];
  total: number;
  kind: LinkKind;
  directory?: DirectoryConfig;
  emptyText: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [extra, setExtra] = useState<LinkRow[]>([]);
  const [moreError, setMoreError] = useState<string | null>(null);

  // A server refresh replaces page 1; drop the appended pages so nothing stale lingers.
  useEffect(() => setExtra([]), [links]);

  const act: Act = async (key, path, body) => {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: "" }));
    const err = await post(path, body);
    setBusy(null);
    if (err) {
      setErrors((e) => ({ ...e, [key]: err }));
      return false;
    }
    router.refresh();
    return true;
  };

  const all = [...links, ...extra.filter((x) => !links.some((l) => l.id === x.id))];
  const page = Math.floor(all.length / LINKS_PAGE_SIZE);

  async function loadMore() {
    setMoreError(null);
    try {
      const res = await fetch(`/api/links?kind=${kind}&limit=${LINKS_PAGE_SIZE}&page=${page + 1}`);
      if (!res.ok) throw new Error("bad status");
      const j = (await res.json()) as { data: LinkRow[] };
      setExtra((e) => [...e, ...j.data]);
    } catch {
      setMoreError("Could not load more, please retry");
    }
  }

  const incoming = all.filter((l) => l.status === "PENDING" && l.direction === "incoming");
  const active = all.filter((l) => l.status === "ACTIVE");
  const other = all.filter((l) => !incoming.includes(l) && l.status !== "ACTIVE");

  return (
    <div className="space-y-6">
      {directory && <Directory config={directory} act={act} busy={busy} errors={errors} version={links} />}
      {incoming.length > 0 && (
        <section aria-labelledby="req-h" className="space-y-2">
          <h2 id="req-h" className="text-xl font-semibold">Requests to you</h2>
          <ul className="space-y-2">
            {incoming.map((l) => (
              <Row key={l.id} link={l} error={errors[l.id]}>
                <Button type="button" disabled={busy === l.id} aria-label={`Approve ${l.counterpart.businessName}`} onClick={() => act(l.id, `/api/links/${l.id}/approve`)}>
                  Approve
                </Button>
                <Button type="button" disabled={busy === l.id} aria-label={`Reject ${l.counterpart.businessName}`} className={ghost} onClick={() => act(l.id, `/api/links/${l.id}/reject`)}>
                  Reject
                </Button>
              </Row>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="linked-h" className="space-y-2">
        <h2 id="linked-h" className="text-xl font-semibold">Linked</h2>
        {active.length === 0 ? (
          <p className="text-muted">{emptyText}</p>
        ) : (
          <ul className="space-y-2">
            {active.map((l) => (
              <Row key={l.id} link={l} error={errors[l.id]}>
                {confirming === l.id ? (
                  <div role="alertdialog" aria-label={`Confirm revoke ${l.counterpart.businessName}`} className="space-y-2">
                    <p className="text-sm">New orders will be blocked. Existing documents stay.</p>
                    <div className="flex gap-2">
                      <Button type="button" disabled={busy === l.id} className="bg-danger text-primary-fg" onClick={async () => { if (await act(l.id, `/api/links/${l.id}/revoke`)) setConfirming(null); }}>
                        Confirm revoke
                      </Button>
                      <Button type="button" className={ghost} onClick={() => setConfirming(null)}>
                        Keep link
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" className={ghost} aria-label={`Revoke ${l.counterpart.businessName}`} onClick={() => setConfirming(l.id)}>
                    Revoke
                  </Button>
                )}
              </Row>
            ))}
          </ul>
        )}
      </section>
      {other.length > 0 && (
        <section aria-labelledby="other-h" className="space-y-2">
          <h2 id="other-h" className="text-xl font-semibold">Requests and history</h2>
          <ul className="space-y-2">
            {other.map((l) => (
              <Row key={l.id} link={l} error={errors[l.id]}>
                {l.status === "PENDING" && l.direction === "outgoing" && (
                  <Button type="button" disabled={busy === l.id} className={ghost} aria-label={`Cancel request to ${l.counterpart.businessName}`} onClick={() => act(l.id, `/api/links/${l.id}/cancel`)}>
                    Cancel request
                  </Button>
                )}
              </Row>
            ))}
          </ul>
        </section>
      )}
      {all.length < total && (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            Showing {all.length} of {total}.
          </p>
          <Button type="button" className={ghost} onClick={loadMore}>
            Load more
          </Button>
          {moreError && <p role="alert" className="text-sm text-danger">{moreError}</p>}
        </div>
      )}
    </div>
  );
}

function Row({ link, error, children }: { link: LinkRow; error?: string; children?: React.ReactNode }) {
  const pendingMine = link.status === "PENDING" && link.direction === "outgoing";
  return (
    <li className="space-y-2 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-semibold">
            {link.counterpart.businessName}
            <span className="font-normal text-muted">{place(link.counterpart.city)}</span>
          </p>
          <LinkStatusBadge status={link.status} label={pendingMine ? "Pending - you requested" : undefined} />
        </div>
        {children && <div className="flex gap-2">{children}</div>}
      </div>
      <RowError message={error} />
    </li>
  );
}

/** `version` changes when the server re-sends the links (after an action), so link states in the open directory stay current. */
function Directory({ config, act, busy, errors, version }: { config: DirectoryConfig; act: Act; busy: string | null; errors: Errors; version: unknown }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<DirectoryRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const seq = useRef(0);

  /** Loads pages 1..page for `query`. A response from an older request is ignored. */
  const load = useCallback(
    async (query: string, page = 1, append = false) => {
      const mine = ++seq.current;
      setLoadError(null);
      try {
        const res = await fetch(`${config.url}?limit=${DIRECTORY_PAGE_SIZE}&page=${page}${query ? `&q=${encodeURIComponent(query)}` : ""}`);
        if (!res.ok) throw new Error("bad status");
        const j = (await res.json()) as { data: DirectoryRow[]; meta: { total: number } };
        if (mine !== seq.current) return;
        setRows((prev) => (append && prev ? [...prev, ...j.data] : j.data));
        setTotal(j.meta.total);
      } catch {
        if (mine !== seq.current) return;
        setRows(null);
        setTotal(0);
        setLoadError("Could not load the directory, please retry");
      }
    },
    [config.url],
  );
  const qRef = useRef(q);
  qRef.current = q;
  useEffect(() => {
    if (open) void load(qRef.current.trim());
  }, [open, load, version]);

  async function request(r: DirectoryRow) {
    if (await act(r.id, "/api/links", { targetId: r.id })) await load(q.trim());
  }

  return (
    <section aria-label={config.findLabel} className="space-y-3">
      <Button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {config.findLabel}
      </Button>
      {open && (
        <div className="space-y-3 rounded-card border border-border bg-surface p-4">
          <form
            role="search"
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void load(q.trim());
            }}
          >
            <label htmlFor="dir-q" className="sr-only">Search by business name or city</label>
            <input id="dir-q" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} placeholder="Search by business name or city" className="min-h-11 w-full rounded-input border border-border bg-surface px-3 text-base" />
            <Button type="submit" className={ghost}>Search</Button>
          </form>
          {loadError && <p role="alert" className="text-sm text-danger">{loadError}</p>}
          {rows && rows.length === 0 && <p className="text-muted">No approved parties match.</p>}
          <ul className="space-y-2">
            {rows?.map((r) => {
              const canRequest = r.linkStatus === null || r.linkStatus === "REJECTED" || r.linkStatus === "REVOKED";
              return (
                <li key={r.id} className="space-y-1 border-b border-border pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">
                      {r.businessName}
                      <span className="font-normal text-muted">{place(r.city)}</span>
                    </span>
                    {canRequest ? (
                      <Button type="button" disabled={busy === r.id} aria-label={`Request link to ${r.businessName}`} onClick={() => request(r)}>
                        {r.linkStatus ? "Request again" : "Request link"}
                      </Button>
                    ) : (
                      r.linkStatus && <LinkStatusBadge status={r.linkStatus} />
                    )}
                  </div>
                  <RowError message={errors[r.id]} />
                </li>
              );
            })}
          </ul>
          {rows && rows.length < total && (
            <Button type="button" className={ghost} onClick={() => void load(q.trim(), Math.floor(rows.length / DIRECTORY_PAGE_SIZE) + 1, true)}>
              Load more
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
