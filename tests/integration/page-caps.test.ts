import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";

const state = { headers: new Headers({ origin: "http://localhost:3000" }), cookies: new Map<string, string>() };
vi.mock("next/headers", () => ({
  headers: async () => state.headers,
  cookies: async () => ({ get: (n: string) => (state.cookies.has(n) ? { name: n, value: state.cookies.get(n) } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const dir = mkdtempSync(path.join(tmpdir(), "cl-cap-"));
process.env.DATABASE_URL = `file:${path.join(dir, "c.db")}`;
process.env.APP_URL = "http://localhost:3000";

type Route = (req: Request, ctx?: unknown) => Promise<Response>;
let usersGet: Route;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let sess: typeof import("@/server/auth/session");
let schema: typeof import("@/server/db/schema");

async function mkUser(id: string, role: "CUSTOMER" | "ADMIN") {
  await db.insert(schema.users).values({
    id, email: `${id}@x.com`, passwordHash: "x", role, status: "ACTIVE", name: id, createdAt: Date.now(),
  });
  const { token } = await sess.createSession(db, id, 1);
  state.cookies.set("cl_session", token);
}

beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  sess = await import("@/server/auth/session");
  schema = await import("@/server/db/schema");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  usersGet = (await import("@/app/api/admin/users/route")).GET as unknown as Route;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("page cap (MAX_PAGE=1000) on every list endpoint", () => {
  it("GET /api/admin/users", async () => {
    await mkUser("cap-admin", "ADMIN");
    expect((await usersGet(new Request("http://localhost:3000/api/admin/users?page=1000"))).status).toBe(200);
    expect((await usersGet(new Request("http://localhost:3000/api/admin/users?page=1001"))).status).toBe(400);
  });
});
