-- 0004 : praticiennes et planning (§7.3). « Multi-praticiennes prêt » : table staff dès la v1.
-- Toutes les heures d'ouverture sont des heures locales du salon (Europe/Paris) ; le moteur de
-- disponibilités les convertit en instants UTC en gérant les changements d'heure.
CREATE TABLE staff (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name  text NOT NULL,
  role_label    text NOT NULL DEFAULT 'Locticienne',
  bio           text,
  photo_path    text,
  active        boolean NOT NULL DEFAULT true,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE staff IS 'Praticiennes réservables. Une seule au départ, plusieurs possibles sans changer le schéma.';

-- Un compte admin peut être rattaché à une praticienne (agenda personnel).
ALTER TABLE users ADD COLUMN staff_id bigint REFERENCES staff (id) ON DELETE SET NULL;

-- Prestations réalisées par chaque praticienne.
CREATE TABLE staff_services (
  staff_id    bigint NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  service_id  bigint NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);
CREATE INDEX staff_services_service_idx ON staff_services (service_id);

-- Horaires hebdomadaires. Plusieurs plages par jour possibles (ex. 9h-12h puis 14h-19h).
-- weekday : 1 = lundi … 7 = dimanche (ISO 8601).
CREATE TABLE opening_hours (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id   bigint NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  opens_at   time NOT NULL,
  closes_at  time NOT NULL,
  CONSTRAINT opening_hours_order CHECK (closes_at > opens_at),
  -- Deux plages d'une même journée ne se chevauchent pas (comparées en minutes depuis minuit).
  CONSTRAINT opening_hours_no_overlap EXCLUDE USING gist (
    staff_id WITH =,
    weekday WITH =,
    int4range(
      (EXTRACT(HOUR FROM opens_at) * 60 + EXTRACT(MINUTE FROM opens_at))::integer,
      (EXTRACT(HOUR FROM closes_at) * 60 + EXTRACT(MINUTE FROM closes_at))::integer
    ) WITH &&
  )
);
COMMENT ON TABLE opening_hours IS 'Horaires hebdomadaires par praticienne. Vide tant que la propriétaire ne les a pas confirmés.';

-- Exceptions au planning hebdomadaire : fermetures, congés ou horaires spéciaux, sur une ou plusieurs dates.
-- staff_id NULL = tout le salon.
CREATE TABLE closures (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id    bigint REFERENCES staff (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('closed', 'special_hours')),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  opens_at    time,            -- horaires spéciaux uniquement
  closes_at   time,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT closures_dates CHECK (ends_on >= starts_on),
  CONSTRAINT closures_hours CHECK (
    (kind = 'closed' AND opens_at IS NULL AND closes_at IS NULL)
    OR (kind = 'special_hours' AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)
  )
);
CREATE INDEX closures_dates_idx ON closures (starts_on, ends_on);

-- Blocages manuels ponctuels (pause, rendez-vous perso), en instants précis.
CREATE TABLE blocks (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id    bigint NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blocks_order CHECK (ends_at > starts_at)
);
CREATE INDEX blocks_range_idx ON blocks USING gist (staff_id, tstzrange(starts_at, ends_at, '[)'));
COMMENT ON TABLE blocks IS 'Indisponibilités manuelles. Le moteur les soustrait aux créneaux libres, comme les rendez-vous.';

CREATE TRIGGER staff_updated_at BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION set_updated_at();
