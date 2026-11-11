DROP TABLE `invoices`;--> statement-breakpoint
DROP TABLE `purchase_orders`;--> statement-breakpoint
DROP TABLE `request_lines`;--> statement-breakpoint
DROP TABLE `requests`;--> statement-breakpoint
CREATE TABLE `customer_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`distributor_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`invoice_no` text NOT NULL,
	`invoice_date` text NOT NULL,
	`qty_kg` integer NOT NULL,
	`rate_per_tonne_paise` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`status` text DEFAULT 'ISSUED' NOT NULL,
	`payment_requested_at` integer,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "customer_invoices_qty_chk" CHECK("customer_invoices"."qty_kg" > 0),
	CONSTRAINT "customer_invoices_rate_chk" CHECK("customer_invoices"."rate_per_tonne_paise" BETWEEN 1 AND 10000000),
	CONSTRAINT "customer_invoices_amount_chk" CHECK("customer_invoices"."amount_paise" = ("customer_invoices"."qty_kg" * "customer_invoices"."rate_per_tonne_paise" + 500) / 1000),
	CONSTRAINT "customer_invoices_status_chk" CHECK("customer_invoices"."status" IN ('ISSUED','PAYMENT_REQUESTED','PAID'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_invoices_order_uq` ON `customer_invoices` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_invoices_no_uq` ON `customer_invoices` (`distributor_id`,`invoice_no`);--> statement-breakpoint
CREATE INDEX `customer_invoices_customer_idx` ON `customer_invoices` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `customer_invoices_distributor_idx` ON `customer_invoices` (`distributor_id`,`status`);--> statement-breakpoint
CREATE TABLE `dispatches` (
	`id` text PRIMARY KEY NOT NULL,
	`po_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`distributor_id` text NOT NULL,
	`dispatch_date` text NOT NULL,
	`vehicle_no` text,
	`driver_phone` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dispatches_vehicle_chk" CHECK("dispatches"."vehicle_no" IS NULL OR (length("dispatches"."vehicle_no") BETWEEN 4 AND 12 AND "dispatches"."vehicle_no" NOT GLOB '*[^A-Z0-9]*')),
	CONSTRAINT "dispatches_phone_chk" CHECK("dispatches"."driver_phone" IS NULL OR (length("dispatches"."driver_phone") = 10 AND "dispatches"."driver_phone" GLOB '[6-9]*' AND "dispatches"."driver_phone" NOT GLOB '*[^0-9]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dispatches_po_uq` ON `dispatches` (`po_id`);--> statement-breakpoint
CREATE INDEX `dispatches_dist_date_idx` ON `dispatches` (`distributor_id`,`dispatch_date`);--> statement-breakpoint
CREATE INDEX `dispatches_date_idx` ON `dispatches` (`dispatch_date`);--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`upper_id` text NOT NULL,
	`lower_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_by` text NOT NULL,
	`decided_at` integer,
	`revoked_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`upper_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lower_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "links_kind_chk" CHECK("links"."kind" IN ('PROVIDER_DISTRIBUTOR','DISTRIBUTOR_CUSTOMER')),
	CONSTRAINT "links_status_chk" CHECK("links"."status" IN ('PENDING','ACTIVE','REJECTED','REVOKED')),
	CONSTRAINT "links_distinct_chk" CHECK("links"."upper_id" <> "links"."lower_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_upper_lower_uq` ON `links` (`upper_id`,`lower_id`);--> statement-breakpoint
CREATE INDEX `links_upper_status_idx` ON `links` (`upper_id`,`status`);--> statement-breakpoint
CREATE INDEX `links_lower_status_idx` ON `links` (`lower_id`,`status`);--> statement-breakpoint
CREATE TABLE `order_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`qty_kg` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_alloc_qty_chk" CHECK("order_allocations"."qty_kg" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_alloc_order_provider_uq` ON `order_allocations` (`order_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`distributor_id` text NOT NULL,
	`qty_kg` integer NOT NULL,
	`address` text NOT NULL,
	`city` text NOT NULL,
	`pincode` text NOT NULL,
	`needed_by` text NOT NULL,
	`status` text DEFAULT 'REQUESTED' NOT NULL,
	`reject_reason` text,
	`opened_at` integer,
	`delivered_at` integer,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_qty_chk" CHECK("orders"."qty_kg" BETWEEN 1 AND 1000000),
	CONSTRAINT "orders_pincode_chk" CHECK(length("orders"."pincode") = 6 AND "orders"."pincode" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "orders_status_chk" CHECK("orders"."status" IN ('REQUESTED','UNDER_REVIEW','POS_PLACED','DISPATCHED','DELIVERED','INVOICED','PAID','REJECTED','CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_distributor_idx` ON `orders` (`distributor_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_invoice_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`distributor_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`status` text NOT NULL,
	`razorpay_order_id` text,
	`razorpay_payment_id` text,
	`failure_reason` text,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_chk" CHECK("payments"."amount_paise" > 0),
	CONSTRAINT "payments_currency_chk" CHECK("payments"."currency" = 'INR'),
	CONSTRAINT "payments_status_chk" CHECK("payments"."status" IN ('CREATED','AUTHORIZED','PAID','FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_razorpay_order_id_unique` ON `payments` (`razorpay_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_razorpay_payment_id_unique` ON `payments` (`razorpay_payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_invoice_paid_uq` ON `payments` (`customer_invoice_id`) WHERE "payments"."status" = 'PAID';--> statement-breakpoint
CREATE UNIQUE INDEX `payments_invoice_created_uq` ON `payments` (`customer_invoice_id`) WHERE "payments"."status" = 'CREATED';--> statement-breakpoint
CREATE TABLE `po_items` (
	`id` text PRIMARY KEY NOT NULL,
	`po_id` text NOT NULL,
	`order_id` text NOT NULL,
	`distributor_id` text NOT NULL,
	`qty_kg` integer NOT NULL,
	`seed_key` text,
	`source_item_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "po_items_qty_chk" CHECK("po_items"."qty_kg" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_items_po_order_uq` ON `po_items` (`po_id`,`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `po_items_seed_key_uq` ON `po_items` (`seed_key`);--> statement-breakpoint
CREATE INDEX `po_items_order_idx` ON `po_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `provider_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`po_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`distributor_id` text NOT NULL,
	`invoice_no` text NOT NULL,
	`invoice_date` text NOT NULL,
	`qty_kg` integer NOT NULL,
	`rate_per_tonne_paise` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`status` text DEFAULT 'UNPAID' NOT NULL,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "provider_invoices_qty_chk" CHECK("provider_invoices"."qty_kg" > 0),
	CONSTRAINT "provider_invoices_rate_chk" CHECK("provider_invoices"."rate_per_tonne_paise" BETWEEN 1 AND 10000000),
	CONSTRAINT "provider_invoices_amount_chk" CHECK("provider_invoices"."amount_paise" = ("provider_invoices"."qty_kg" * "provider_invoices"."rate_per_tonne_paise" + 500) / 1000),
	CONSTRAINT "provider_invoices_status_chk" CHECK("provider_invoices"."status" IN ('UNPAID','PAID'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_invoices_no_uq` ON `provider_invoices` (`provider_id`,`invoice_no`);--> statement-breakpoint
CREATE INDEX `provider_invoices_po_idx` ON `provider_invoices` (`po_id`);--> statement-breakpoint
CREATE INDEX `provider_invoices_provider_idx` ON `provider_invoices` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `provider_invoices_distributor_idx` ON `provider_invoices` (`distributor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `provider_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_invoice_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`distributor_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`paid_on` text NOT NULL,
	`mode` text NOT NULL,
	`reference` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`provider_invoice_id`) REFERENCES `provider_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "provider_payments_amount_chk" CHECK("provider_payments"."amount_paise" > 0),
	CONSTRAINT "provider_payments_mode_chk" CHECK("provider_payments"."mode" IN ('CASH','UPI','NEFT','RTGS','IMPS','CHEQUE','OTHER'))
);
--> statement-breakpoint
CREATE INDEX `provider_payments_invoice_idx` ON `provider_payments` (`provider_invoice_id`);--> statement-breakpoint
CREATE INDEX `provider_payments_pair_idx` ON `provider_payments` (`provider_id`,`distributor_id`,`paid_on`);--> statement-breakpoint
CREATE INDEX `provider_payments_distributor_idx` ON `provider_payments` (`distributor_id`,`paid_on`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`distributor_id` text NOT NULL,
	`provider_id` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`qty_kg` integer,
	`rate_per_tonne_paise` integer,
	`total_paise` integer,
	`reject_reason` text,
	`placed_at` integer,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "po_status_chk" CHECK("purchase_orders"."status" IN ('DRAFT','PLACED','ACCEPTED','REJECTED','DISPATCHED','INVOICED','PAID')),
	CONSTRAINT "po_placed_chk" CHECK("purchase_orders"."status" = 'DRAFT' OR ("purchase_orders"."provider_id" IS NOT NULL AND "purchase_orders"."qty_kg" IS NOT NULL)),
	CONSTRAINT "po_qty_chk" CHECK("purchase_orders"."qty_kg" IS NULL OR "purchase_orders"."qty_kg" > 0),
	CONSTRAINT "po_rate_chk" CHECK("purchase_orders"."rate_per_tonne_paise" IS NULL OR "purchase_orders"."rate_per_tonne_paise" BETWEEN 1 AND 10000000),
	CONSTRAINT "po_total_chk" CHECK("purchase_orders"."total_paise" IS (CASE WHEN "purchase_orders"."rate_per_tonne_paise" IS NULL OR "purchase_orders"."qty_kg" IS NULL THEN NULL ELSE ("purchase_orders"."qty_kg" * "purchase_orders"."rate_per_tonne_paise" + 500) / 1000 END))
);
--> statement-breakpoint
CREATE INDEX `po_distributor_status_idx` ON `purchase_orders` (`distributor_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `po_provider_status_idx` ON `purchase_orders` (`provider_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`razorpay_order_id` text,
	`payload_sha256` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	`result` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_provider_event_id_unique` ON `webhook_events` (`provider_event_id`);