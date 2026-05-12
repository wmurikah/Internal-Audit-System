-- Fix auth issues: HPG affiliate + session timeout
-- Run date: 2026-05-12

-- BUG 4: Add HPG (Hass Petroleum Group) affiliate if missing
INSERT OR IGNORE INTO affiliates
  (affiliate_code, organization_id, affiliate_name, country, region, is_active, display_order)
VALUES
  ('HPG', 'HASS', 'Hass Petroleum Group', 'KE', 'Group', 1, 10);

-- BUG 6: Set session timeout to 8 hours (full working day)
UPDATE config
   SET config_value = '8',
       updated_at   = datetime('now')
 WHERE config_key = 'SESSION_TIMEOUT_HOURS';

-- Insert row if it doesn't exist yet
INSERT OR IGNORE INTO config (config_key, config_value, description, organization_id, updated_at)
VALUES ('SESSION_TIMEOUT_HOURS', '8', 'Session duration in hours', 'GLOBAL', datetime('now'));
