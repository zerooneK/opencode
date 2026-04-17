CREATE TABLE `app_user` (
	`id` text PRIMARY KEY,
	`username` text NOT NULL UNIQUE,
	`password` text NOT NULL,
	`role` text NOT NULL DEFAULT 'user',
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_user_session` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_app_user_session_user_id` FOREIGN KEY (`user_id`) REFERENCES `app_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `app_user_session_user_idx` ON `app_user_session` (`user_id`);
