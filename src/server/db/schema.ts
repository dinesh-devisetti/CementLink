import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { ROLE_VALUES } from "../../lib/constants";

export const ROLES = ROLE_VALUES;
export const STATUSES = ["PENDING", "ACTIVE", "REJECTED"] as const;
export type Role = (typeof ROLES)[number];
export type UserStatus = (typeof STATUSES)[number];

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    status: text("status", { enum: STATUSES }).notNull(),
    name: text("name").notNull(),
    businessName: text("business_name"),
    phone: text("phone"),
    city: text("city"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    check("users_role_chk", sql`${t.role} IN ('CUSTOMER','DISTRIBUTOR','PROVIDER','ADMIN')`),
    check("users_status_chk", sql`${t.status} IN ('PENDING','ACTIVE','REJECTED')`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    key: text("key").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export type User = typeof users.$inferSelect;

export const LINE_STATUSES = ["SENT", "ACCEPTED", "REJECTED", "PAYMENT_PENDING", "PAID"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export const requests = sqliteTable(
  "requests",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id),
    totalBags: integer("total_bags").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    pincode: text("pincode").notNull(),
    neededBy: text("needed_by").notNull(), // YYYY-MM-DD
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("requests_customer_idx").on(t.customerId, t.createdAt),
    check("requests_bags_chk", sql`${t.totalBags} > 0`),
    check("requests_pincode_chk", sql`length(${t.pincode}) = 6 AND ${t.pincode} NOT GLOB '*[^0-9]*'`),
  ],
);

export const requestLines = sqliteTable(
  "request_lines",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    distributorId: text("distributor_id")
      .notNull()
      .references(() => users.id),
    qtyBags: integer("qty_bags").notNull(),
    pricePerBagPaise: integer("price_per_bag_paise"),
    amountPaise: integer("amount_paise"),
    status: text("status", { enum: LINE_STATUSES }).notNull().default("SENT"),
    acceptedAt: integer("accepted_at"),
    paymentRequestedAt: integer("payment_requested_at"),
    paidAt: integer("paid_at"),
  },
  (t) => [
    uniqueIndex("request_lines_req_dist_uq").on(t.requestId, t.distributorId),
    index("request_lines_dist_status_idx").on(t.distributorId, t.status),
    check("request_lines_qty_chk", sql`${t.qtyBags} > 0`),
    check(
      "request_lines_status_chk",
      sql`${t.status} IN ('SENT','ACCEPTED','REJECTED','PAYMENT_PENDING','PAID')`,
    ),
  ],
);

export type RequestRow = typeof requests.$inferSelect;
export type RequestLineRow = typeof requestLines.$inferSelect;

export const PO_STATUSES = ["PLACED", "CONFIRMED", "REJECTED"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    distributorId: text("distributor_id")
      .notNull()
      .references(() => users.id),
    providerId: text("provider_id")
      .notNull()
      .references(() => users.id),
    qtyBags: integer("qty_bags").notNull(),
    ratePerBagPaise: integer("rate_per_bag_paise").notNull(),
    totalPaise: integer("total_paise").notNull(),
    status: text("status", { enum: PO_STATUSES }).notNull().default("PLACED"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("po_provider_idx").on(t.providerId, t.createdAt),
    index("po_distributor_idx").on(t.distributorId, t.createdAt),
    check("po_qty_chk", sql`${t.qtyBags} > 0`),
    check("po_rate_chk", sql`${t.ratePerBagPaise} > 0`),
    check("po_status_chk", sql`${t.status} IN ('PLACED','CONFIRMED','REJECTED')`),
  ],
);

export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
