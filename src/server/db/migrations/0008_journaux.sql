-- 0008 : journal des notifications (§7.6) et journal d'audit des actions admin (§13).

-- Chaque envoi d'email ou de SMS : statut, date, erreur. Visible en admin.
-- recipient contient une donnée personnelle : à purger après 12 mois (cf. docs/DATABASE.md).
CREATE TABLE notifications_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id       uuid REFERENCES appointments (id) ON DELETE SET NULL,
  client_id            uuid REFERENCES clients (id) ON DELETE SET NULL,
  channel              text NOT NULL CHECK (channel IN ('email', 'sms')),
  template             text NOT NULL,        -- ex. booking_confirmation, reminder_d2, review_request
  recipient            text NOT NULL,
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  provider_message_id  text,
  error                text,
  attempts             integer NOT NULL DEFAULT 0,
  scheduled_at         timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_log_appointment_idx ON notifications_log (appointment_id);
CREATE INDEX notifications_log_status_idx ON notifications_log (status, scheduled_at);

-- Journal d'audit : qui a fait quoi. Ne contient jamais de mot de passe ni de secret.
-- Ajout seul : les modifications sont interdites par un déclencheur (la purge par date reste possible).
CREATE TABLE audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  action       text NOT NULL,                 -- ex. service.update, review.approve, login.success
  entity_type  text,
  entity_id    text,
  details      jsonb NOT NULL DEFAULT '{}',
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_user_idx ON audit_log (user_id, created_at DESC);

CREATE FUNCTION audit_log_forbid_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log est en ajout seul : modification interdite';
END;
$$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_forbid_update();
