import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { PAYMENT_MODES, ROLE_VALUES } from "../../lib/constants";

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

// ---------------------------------------------------------------------------------------------
// v2 trade tables (ADR-001 rev 2, section 5). qty is INTEGER kg, money INTEGER paise, rate per tonne.
// amount = (qty_kg * rate_per_tonne_paise + 500) / 1000 (SQLite integer division, round half up).
// ---------------------------------------------------------------------------------------------

const userRef = (name: string) =>
  text(name)
    .notNull()
    .references(() => users.id);
const amountOk = (amount: AnySQLiteColumn, qty: AnySQLiteColumn, rate: AnySQLiteColumn) =>
  sql`${amount} = (${qty} * ${rate} + 500) / 1000`;

export const LINK_KINDS = ["PROVIDER_DISTRIBUTOR", "DISTRIBUTOR_CUSTOMER"] as const;
export const LINK_STATUSES = ["PENDING", "ACTIVE", "REJECTED", "REVOKED"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: LINK_KINDS }).notNull(),
    upperId: userRef("upper_id"),
    lowerId: userRef("lower_id"),
    status: text("status", { enum: LINK_STATUSES }).notNull(),
    requestedBy: userRef("requested_by"),
    decidedAt: integer("decided_at"),
    revokedBy: text("revoked_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("links_upper_lower_uq").on(t.upperId, t.lowerId),
    index("links_upper_status_idx").on(t.upperId, t.status),
    index("links_lower_status_idx").on(t.lowerId, t.status),
    check("links_kind_chk", sql`${t.kind} IN ('PROVIDER_DISTRIBUTOR','DISTRIBUTOR_CUSTOMER')`),
    check("links_status_chk", sql`${t.status} IN ('PENDING','ACTIVE','REJECTED','REVOKED')`),
    check("links_distinct_chk", sql`${t.upperId} <> ${t.lowerId}`),
  ],
);

export const ORDER_STATUSES = [
  "REQUESTED", "UNDER_REVIEW", "POS_PLACED", "DISPATCHED", "DELIVERED", "INVOICED", "PAID", "REJECTED", "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    customerId: userRef("customer_id"),
    distributorId: userRef("distributor_id"),
    qtyKg: integer("qty_kg").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    pincode: text("pincode").notNull(),
    neededBy: text("needed_by").notNull(), // YYYY-MM-DD (IST)
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("REQUESTED"),
    rejectReason: text("reject_reason"),
    openedAt: integer("opened_at"),
    deliveredAt: integer("delivered_at"),
    cancelledAt: integer("cancelled_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("orders_customer_idx").on(t.customerId, t.createdAt),
    index("orders_distributor_idx").on(t.distributorId, t.status, t.createdAt),
    check("orders_qty_chk", sql`${t.qtyKg} BETWEEN 1 AND 1000000`),
    check("orders_pincode_chk", sql`length(${t.pincode}) = 6 AND ${t.pincode} NOT GLOB '*[^0-9]*'`),
    check(
      "orders_status_chk",
      sql`${t.status} IN ('REQUESTED','UNDER_REVIEW','POS_PLACED','DISPATCHED','DELIVERED','INVOICED','PAID','REJECTED','CANCELLED')`,
    ),
  ],
);

export const orderAllocations = sqliteTable(
  "order_allocations",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    providerId: userRef("provider_id"),
    qtyKg: integer("qty_kg").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("order_alloc_order_provider_uq").on(t.orderId, t.providerId),
    check("order_alloc_qty_chk", sql`${t.qtyKg} > 0`),
  ],
);

export const PO_STATUSES = ["DRAFT", "PLACED", "ACCEPTED", "REJECTED", "DISPATCHED", "INVOICED", "PAID"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

// NOTE: SQLite table rebuilds (drizzle-kit CHECK/column changes) disable FK enforcement; any future migration that
// rebuilds a table with dependants (purchase_orders, orders, customer_invoices, ...) must finish with
// `PRAGMA foreign_key_check` and fail on any rows (ADR-001 section 11.6).
export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    distributorId: userRef("distributor_id"),
    providerId: text("provider_id").references(() => users.id),
    status: text("status", { enum: PO_STATUSES }).notNull().default("DRAFT"),
    version: integer("version").notNull().default(0),
    qtyKg: integer("qty_kg"),
    ratePerTonnePaise: integer("rate_per_tonne_paise"),
    totalPaise: integer("total_paise"),
    rejectReason: text("reject_reason"),
    placedAt: integer("placed_at"),
    decidedAt: integer("decided_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("po_distributor_status_idx").on(t.distributorId, t.status, t.createdAt),
    index("po_provider_status_idx").on(t.providerId, t.status, t.createdAt),
    check("po_status_chk", sql`${t.status} IN ('DRAFT','PLACED','ACCEPTED','REJECTED','DISPATCHED','INVOICED','PAID')`),
    check("po_placed_chk", sql`${t.status} = 'DRAFT' OR (${t.providerId} IS NOT NULL AND ${t.qtyKg} IS NOT NULL)`),
    check("po_qty_chk", sql`${t.qtyKg} IS NULL OR ${t.qtyKg} > 0`),
    check("po_rate_chk", sql`${t.ratePerTonnePaise} IS NULL OR ${t.ratePerTonnePaise} BETWEEN 1 AND 10000000`),
    check(
      "po_total_chk",
      sql`${t.totalPaise} IS (CASE WHEN ${t.ratePerTonnePaise} IS NULL OR ${t.qtyKg} IS NULL THEN NULL ELSE (${t.qtyKg} * ${t.ratePerTonnePaise} + 500) / 1000 END)`,
    ),
  ],
);

export const poItems = sqliteTable(
  "po_items",
  {
    id: text("id").primaryKey(),
    poId: text("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    distributorId: userRef("distributor_id"),
    qtyKg: integer("qty_kg").notNull(),
    seedKey: text("seed_key"),
    sourceItemId: text("source_item_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("po_items_po_order_uq").on(t.poId, t.orderId),
    uniqueIndex("po_items_seed_key_uq").on(t.seedKey),
    index("po_items_order_idx").on(t.orderId),
    check("po_items_qty_chk", sql`${t.qtyKg} > 0`),
  ],
);

export const dispatches = sqliteTable(
  "dispatches",
  {
    id: text("id").primaryKey(),
    poId: text("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    providerId: userRef("provider_id"),
    distributorId: userRef("distributor_id"),
    dispatchDate: text("dispatch_date").notNull(), // YYYY-MM-DD (IST)
    vehicleNo: text("vehicle_no"),
    driverPhone: text("driver_phone"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("dispatches_po_uq").on(t.poId),
    index("dispatches_dist_date_idx").on(t.distributorId, t.dispatchDate),
    index("dispatches_date_idx").on(t.dispatchDate),
    check("dispatches_vehicle_chk", sql`${t.vehicleNo} IS NULL OR (length(${t.vehicleNo}) BETWEEN 4 AND 12 AND ${t.vehicleNo} NOT GLOB '*[^A-Z0-9]*')`),
    check("dispatches_phone_chk", sql`${t.driverPhone} IS NULL OR (length(${t.driverPhone}) = 10 AND ${t.driverPhone} GLOB '[6-9]*' AND ${t.driverPhone} NOT GLOB '*[^0-9]*')`),
  ],
);

export const PROVIDER_INVOICE_STATUSES = ["UNPAID", "PAID"] as const;

export const providerInvoices = sqliteTable(
  "provider_invoices",
  {
    id: text("id").primaryKey(),
    poId: text("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    providerId: userRef("provider_id"),
    distributorId: userRef("distributor_id"),
    invoiceNo: text("invoice_no").notNull(),
    invoiceDate: text("invoice_date").notNull(),
    qtyKg: integer("qty_kg").notNull(),
    ratePerTonnePaise: integer("rate_per_tonne_paise").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    status: text("status", { enum: PROVIDER_INVOICE_STATUSES }).notNull().default("UNPAID"),
    paidAt: integer("paid_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("provider_invoices_no_uq").on(t.providerId, t.invoiceNo),
    index("provider_invoices_po_idx").on(t.poId),
    index("provider_invoices_provider_idx").on(t.providerId, t.createdAt),
    index("provider_invoices_distributor_idx").on(t.distributorId, t.createdAt),
    check("provider_invoices_qty_chk", sql`${t.qtyKg} > 0`),
    check("provider_invoices_rate_chk", sql`${t.ratePerTonnePaise} BETWEEN 1 AND 10000000`),
    check("provider_invoices_amount_chk", amountOk(t.amountPaise, t.qtyKg, t.ratePerTonnePaise)),
    check("provider_invoices_status_chk", sql`${t.status} IN ('UNPAID','PAID')`),
  ],
);

export const providerPayments = sqliteTable(
  "provider_payments",
  {
    id: text("id").primaryKey(),
    providerInvoiceId: text("provider_invoice_id")
      .notNull()
      .references(() => providerInvoices.id),
    providerId: userRef("provider_id"),
    distributorId: userRef("distributor_id"),
    amountPaise: integer("amount_paise").notNull(),
    paidOn: text("paid_on").notNull(),
    mode: text("mode", { enum: PAYMENT_MODES }).notNull(),
    reference: text("reference"),
    createdBy: userRef("created_by"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("provider_payments_invoice_idx").on(t.providerInvoiceId),
    index("provider_payments_pair_idx").on(t.providerId, t.distributorId, t.paidOn),
    index("provider_payments_distributor_idx").on(t.distributorId, t.paidOn),
    check("provider_payments_amount_chk", sql`${t.amountPaise} > 0`),
    check("provider_payments_mode_chk", sql`${t.mode} IN ('CASH','UPI','NEFT','RTGS','IMPS','CHEQUE','OTHER')`),
  ],
);

export const CUSTOMER_INVOICE_STATUSES = ["ISSUED", "PAYMENT_REQUESTED", "PAID"] as const;

export const customerInvoices = sqliteTable(
  "customer_invoices",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    distributorId: userRef("distributor_id"),
    customerId: userRef("customer_id"),
    invoiceNo: text("invoice_no").notNull(),
    invoiceDate: text("invoice_date").notNull(),
    qtyKg: integer("qty_kg").notNull(),
    ratePerTonnePaise: integer("rate_per_tonne_paise").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    status: text("status", { enum: CUSTOMER_INVOICE_STATUSES }).notNull().default("ISSUED"),
    paymentRequestedAt: integer("payment_requested_at"),
    paidAt: integer("paid_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("customer_invoices_order_uq").on(t.orderId),
    uniqueIndex("customer_invoices_no_uq").on(t.distributorId, t.invoiceNo),
    index("customer_invoices_customer_idx").on(t.customerId, t.createdAt),
    index("customer_invoices_distributor_idx").on(t.distributorId, t.status),
    check("customer_invoices_qty_chk", sql`${t.qtyKg} > 0`),
    check("customer_invoices_rate_chk", sql`${t.ratePerTonnePaise} BETWEEN 1 AND 10000000`),
    check("customer_invoices_amount_chk", amountOk(t.amountPaise, t.qtyKg, t.ratePerTonnePaise)),
    check("customer_invoices_status_chk", sql`${t.status} IN ('ISSUED','PAYMENT_REQUESTED','PAID')`),
  ],
);

export const PAYMENT_STATUSES = ["CREATED", "AUTHORIZED", "PAID", "FAILED"] as const;

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    customerInvoiceId: text("customer_invoice_id")
      .notNull()
      .references(() => customerInvoices.id),
    customerId: userRef("customer_id"),
    distributorId: userRef("distributor_id"),
    amountPaise: integer("amount_paise").notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull(),
    razorpayOrderId: text("razorpay_order_id").unique(),
    razorpayPaymentId: text("razorpay_payment_id").unique(),
    failureReason: text("failure_reason"),
    paidAt: integer("paid_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("payments_invoice_paid_uq").on(t.customerInvoiceId).where(sql`${t.status} = 'PAID'`),
    uniqueIndex("payments_invoice_created_uq").on(t.customerInvoiceId).where(sql`${t.status} = 'CREATED'`),
    check("payments_amount_chk", sql`${t.amountPaise} > 0`),
    check("payments_currency_chk", sql`${t.currency} = 'INR'`),
    check("payments_status_chk", sql`${t.status} IN ('CREATED','AUTHORIZED','PAID','FAILED')`),
  ],
);

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  providerEventId: text("provider_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  razorpayOrderId: text("razorpay_order_id"),
  payloadSha256: text("payload_sha256").notNull(),
  receivedAt: integer("received_at").notNull(),
  processedAt: integer("processed_at"),
  result: text("result"),
});

export type LinkRow = typeof links.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
export type PoItemRow = typeof poItems.$inferSelect;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
