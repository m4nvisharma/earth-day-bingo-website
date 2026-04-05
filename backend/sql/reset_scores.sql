BEGIN;

DELETE FROM user_item_status;
DELETE FROM user_daily_actions;
UPDATE users SET certificate_earned_at = NULL;

COMMIT;
