-- Migration: Add template columns to sub_areas and AI config keys to config
-- Date: 2026-05-14

-- ── Sub Areas: add missing template columns ──────────────────────────────────
ALTER TABLE sub_areas ADD COLUMN control_standards TEXT;
ALTER TABLE sub_areas ADD COLUMN default_control_classification TEXT;
ALTER TABLE sub_areas ADD COLUMN default_control_type TEXT;
ALTER TABLE sub_areas ADD COLUMN default_control_frequency TEXT;

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT 'sub_areas.control_standards'              AS check_name, COUNT(*) AS present
FROM pragma_table_info('sub_areas') WHERE name = 'control_standards';
SELECT 'sub_areas.default_control_classification' AS check_name, COUNT(*) AS present
FROM pragma_table_info('sub_areas') WHERE name = 'default_control_classification';
SELECT 'sub_areas.default_control_type'           AS check_name, COUNT(*) AS present
FROM pragma_table_info('sub_areas') WHERE name = 'default_control_type';
SELECT 'sub_areas.default_control_frequency'      AS check_name, COUNT(*) AS present
FROM pragma_table_info('sub_areas') WHERE name = 'default_control_frequency';
