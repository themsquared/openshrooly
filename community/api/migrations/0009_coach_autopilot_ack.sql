-- Autopilot cloud delivery ack. Additive only. D1 has no ADD COLUMN IF NOT EXISTS; apply once.
ALTER TABLE coach_device_mode ADD COLUMN pending_command_id INTEGER;
ALTER TABLE coach_device_mode ADD COLUMN delivery TEXT;
ALTER TABLE coach_autopilot_log ADD COLUMN command_id INTEGER;
ALTER TABLE coach_autopilot_log ADD COLUMN apply_status TEXT;
CREATE INDEX IF NOT EXISTS idx_coach_autopilot_log_command ON coach_autopilot_log(command_id);
