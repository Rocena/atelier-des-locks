-- Réglages par défaut (cahier des charges §7.3, §7.5). Idempotent.
-- TODO-PROPRIO : délais, horaires et politique d'annulation à confirmer.
INSERT INTO settings (key, value) VALUES
  ('booking.min_notice_hours', '24'),
  ('booking.horizon_days', '60'),
  ('booking.cancellation_hours', '48'),
  ('booking.manual_validation', 'false'),
  -- Pas entre deux débuts de créneau proposés (minutes).
  ('booking.slot_step_minutes', '30'),
  -- À partir de cette durée bloquée (minutes), un RDV peut traverser la pause de midi.
  ('booking.long_service_minutes', '240'),
  -- Texte de la politique de RDV affiché à l'étape 3 et sur « Gérer mon RDV » (éditable en admin).
  ('booking.policy_text', '"Vous pouvez déplacer ou annuler gratuitement votre rendez-vous jusqu’à 48 h avant. Passé ce délai, appelez le salon. En cas de retard de plus de 20 minutes, le rendez-vous peut être écourté ou reporté."'),
  ('salon.timezone', '"Europe/Paris"'),
  ('salon.city', '"Toulouse"')
ON CONFLICT (key) DO NOTHING;
