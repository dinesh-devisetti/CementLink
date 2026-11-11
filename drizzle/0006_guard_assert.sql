CREATE VIEW `guard_assert` AS SELECT 1 AS `ok`;--> statement-breakpoint
CREATE TRIGGER `guard_assert_ins` INSTEAD OF INSERT ON `guard_assert` WHEN NEW.`ok` IS NOT 1 BEGIN SELECT RAISE(ABORT, 'ASSERT_FAILED'); END;
