CREATE TABLE `purchase_orders` (
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
	CONSTRAINT "po_qty_chk" CHECK("purchase_orders"."qty_bags" > 0),
	CONSTRAINT "po_rate_chk" CHECK("purchase_orders"."rate_per_bag_paise" > 0),
	CONSTRAINT "po_status_chk" CHECK("purchase_orders"."status" IN ('PLACED','CONFIRMED','REJECTED'))
);
--> statement-breakpoint
CREATE INDEX `po_provider_idx` ON `purchase_orders` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `po_distributor_idx` ON `purchase_orders` (`distributor_id`,`created_at`);