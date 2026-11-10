CREATE TABLE `request_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`distributor_id` text NOT NULL,
	`qty_bags` integer NOT NULL,
	`price_per_bag_paise` integer,
	`amount_paise` integer,
	`status` text DEFAULT 'SENT' NOT NULL,
	`accepted_at` integer,
	`payment_requested_at` integer,
	`paid_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`distributor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "request_lines_qty_chk" CHECK("request_lines"."qty_bags" > 0),
	CONSTRAINT "request_lines_status_chk" CHECK("request_lines"."status" IN ('SENT','ACCEPTED','REJECTED','PAYMENT_PENDING','PAID'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `request_lines_req_dist_uq` ON `request_lines` (`request_id`,`distributor_id`);--> statement-breakpoint
CREATE INDEX `request_lines_dist_status_idx` ON `request_lines` (`distributor_id`,`status`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`total_bags` integer NOT NULL,
	`address` text NOT NULL,
	`city` text NOT NULL,
	`pincode` text NOT NULL,
	`needed_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "requests_bags_chk" CHECK("requests"."total_bags" > 0),
	CONSTRAINT "requests_pincode_chk" CHECK(length("requests"."pincode") = 6 AND "requests"."pincode" NOT GLOB '*[^0-9]*')
);
--> statement-breakpoint
CREATE INDEX `requests_customer_idx` ON `requests` (`customer_id`,`created_at`);