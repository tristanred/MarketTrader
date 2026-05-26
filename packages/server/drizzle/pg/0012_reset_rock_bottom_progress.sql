-- Migrate in-progress rock-bottom rows from the old snapshot-count target (5)
-- to the new day-based target (3). Unlocked rows are left untouched so prior
-- earners keep credit; only progress rows still in flight are reset.
UPDATE achievement_progress
SET progress = 0, target = 3
WHERE achievement_key = 'rock-bottom' AND unlocked_at IS NULL;
