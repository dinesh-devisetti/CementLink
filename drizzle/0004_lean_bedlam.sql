PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`distributor_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`qty_bags` integer NOT NULL,
	`rate_per_bag_paise` integer NOT NULL,
	`total_paise` integer NOT NULL,
	`status` text DEFAULT 'PLACED' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "po_qty_chk" CHECK("__new_purchase_orders"."qty_bags" > 0),
	CONSTRAINT "po_rate_chk" CHECK("__new_purchase_orders"."rate_per_bag_paise" > 0),
	CONSTRAINT "po_total_chk" CHECK("__new_purchase_orders"."total_paise" = "__new_purchase_orders"."qty_bags" * "__new_purchase_orders"."rate_per_bag_paise"),
	CONSTRAINT "po_status_chk" CHECK("__new_purchase_orders"."status" IN ('PLACED','CONFIRMED','REJECTED'))
);
--> statement-breakpoint
INSERT INTO `__new_purchase_orders`("id", "distributor_id", "provider_id", "qty_bags", "rate_per_bag_paise", "total_paise", "status", "created_at") SELECT "id", "distributor_id", "provider_id", "qty_bags", "rate_per_bag_paise", "total_paise", "status", "created_at" FROM `purchase_orders`;--> statement-breakpoint
DROP TABLE `purchase_orders`;--> statement-breakpoint
ALTER TABLE `__new_purchase_orders` RENAME TO `purchase_orders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `po_provider_idx` ON `purchase_orders` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `po_distributor_idx` ON `purchase_orders` (`distributor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`po_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`distributor_id` text NOT NULL,
	`invoice_no` text NOT NULL,
	`invoice_date` text NOT NULL,
	`qty_bags` integer NOT NULL,
	`rate_per_bag_paise` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoices_qty_chk" CHECK("invoices"."qty_bags" > 0),
	CONSTRAINT "invoices_rate_chk" CHECK("invoices"."rate_per_bag_paise" > 0),
	CONSTRAINT "invoices_amount_chk" CHECK("invoices"."amount_paise" = "invoices"."qty_bags" * "invoices"."rate_per_bag_paise")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_provider_no_uq` ON `invoices` (`provider_id`,`invoice_no`);--> statement-breakpoint
CREATE INDEX `invoices_po_idx` ON `invoices` (`po_id`);--> statement-breakpoint
CREATE INDEX `invoices_provider_idx` ON `invoices` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `invoices_distributor_idx` ON `invoices` (`distributor_id`,`created_at`);
