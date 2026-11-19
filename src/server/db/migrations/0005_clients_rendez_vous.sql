-- 0005 : clientes et rendez-vous (§7). Contrainte d'exclusion anti-double-réservation.
-- Données personnelles : email, téléphone, photo de cheveux (RGPD, §14). Durées de conservation
-- documentées dans docs/DATABASE.md ; anonymized_at permet d'anonymiser sans casser l'historique.
CREATE TABLE clients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name            text NOT NULL,
  last_name             text NOT NULL,
  email                 citext NOT NULL UNIQUE,
  phone                 text,                              -- format E.164 normalisé par l'application
  sms_reminders         boolean NOT NULL DEFAULT true,     -- SMS transactionnels (cochée par défaut)
  newsletter_opt_in     boolean NOT NULL DEFAULT false,    -- opt-in séparé, JAMAIS coché par défaut
  newsletter_opt_in_at  timestamptz,                       -- preuve du consentement
  internal_notes        text,
  anonymized_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_optin_proof CHECK (NOT newsletter_opt_in OR newsletter_opt_in_at IS NOT NULL)
);

-- Statuts (§7.4) : pending (en attente de validation), confirmed, completed, cancelled_by_client,
-- cancelled_by_salon, no_show (absence).
CREATE TABLE appointments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,
  staff_id                 bigint NOT NULL REFERENCES staff (id) ON DELETE RESTRICT,
  service_id               bigint NOT NULL REFERENCES services (id) ON DELETE RESTRICT,
  status                   text NOT NULL DEFAULT 'confirmed' CHECK (status IN (
                             'pending', 'confirmed', 'completed',
                             'cancelled_by_client', 'cancelled_by_salon', 'no_show')),
  starts_at                timestamptz NOT NULL,
  -- Fin de l'occupation du planning : durée max + options + tampon (§7.3).
  ends_at                  timestamptz NOT NULL,
  -- Instantané au moment de la réservation (le catalogue peut changer ensuite).
  duration_minutes         integer NOT NULL CHECK (duration_minutes > 0),
  buffer_minutes           integer NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  price_cents              integer CHECK (price_cents >= 0),
  price_from               boolean NOT NULL DEFAULT false,
  hair_state               text,
  client_notes             text,
  hair_photo_path          text,                              -- photo des cheveux (hors webroot)
  internal_notes           text,
  policy_accepted_at       timestamptz NOT NULL,              -- acceptation de la politique de RDV
  -- Lien « Gérer mon RDV » : jeton ≥ 32 octets, seule l'empreinte SHA-256 est stockée (§13).
  manage_token_hash        bytea UNIQUE,
  manage_token_expires_at  timestamptz,
  cancelled_at             timestamptz,
  cancellation_reason      text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_order CHECK (ends_at > starts_at),
  -- ANTI-DOUBLE-RÉSERVATION : une même praticienne ne peut pas avoir deux rendez-vous dont les
  -- intervalles [début, fin[ se chevauchent. Les rendez-vous annulés libèrent le créneau.
  -- La contrainte tient même sous concurrence ; le service réserve en plus dans une transaction
  -- (violation = SQLSTATE 23P01, à traduire en « créneau déjà pris »).
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('pending', 'confirmed', 'completed', 'no_show'))
);
CREATE INDEX appointments_client_idx ON appointments (client_id);
CREATE INDEX appointments_starts_idx ON appointments (starts_at);
CREATE INDEX appointments_status_idx ON appointments (status, starts_at);
COMMENT ON TABLE appointments IS 'Rendez-vous. Source de vérité du planning (ADR 0001). Les blocages manuels (blocks) sont contrôlés par le moteur.';
COMMENT ON CONSTRAINT appointments_no_overlap ON appointments IS 'Anti-chevauchement par praticienne (btree_gist, §7.3).';

-- Options choisies pour un rendez-vous (libellé et prix figés).
CREATE TABLE appointment_options (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  appointment_id  uuid NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  option_id       bigint REFERENCES service_options (id) ON DELETE SET NULL,
  label           text NOT NULL,
  price_cents     integer NOT NULL CHECK (price_cents >= 0),
  extra_minutes   integer NOT NULL DEFAULT 0 CHECK (extra_minutes >= 0)
);
CREATE INDEX appointment_options_appointment_idx ON appointment_options (appointment_id);

CREATE TRIGGER clients_updated_at      BEFORE UPDATE ON clients      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
