-- Réglages par défaut (cahier des charges §7.3, §7.5). Idempotent.
-- TODO-PROPRIO : délais, horaires et politique d'annulation à confirmer.
INSERT INTO settings (key, value) VALUES
  ('booking.min_notice_hours', '24'),
  ('booking.horizon_days', '60'),
  ('booking.cancellation_hours', '48'),
  ('booking.manual_validation', 'false'),
  ('salon.timezone', '"Europe/Paris"'),
  ('salon.city', '"Toulouse"')
ON CONFLICT (key) DO NOTHING;
