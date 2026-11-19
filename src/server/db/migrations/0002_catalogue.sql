-- 0002 : catalogue (cahier des charges §6) : catégories, prestations, méthodes, options, photos, FAQ.
-- Conventions du schéma (valables pour toutes les migrations) :
--   * identifiants internes en bigint identity ; uuid pour tout ce qui peut apparaître dans une URL
--     ou contenir des données personnelles (clients, rendez-vous, avis, utilisateurs) ;
--   * prix en centimes (integer), jamais en flottant ;
--   * durées en minutes ; dates et heures en timestamptz (UTC), converties en Europe/Paris à l'affichage ;
--   * slugs en minuscules/chiffres/tirets, contrôlés par un CHECK ;
--   * toute valeur d'exemple à faire valider par la propriétaire porte is_placeholder = true.

-- Fonction partagée : tient à jour la colonne updated_at (déclencheur BEFORE UPDATE).
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Catégories : installation, resserrage, détox, coloration, coiffure.
CREATE TABLE categories (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text NOT NULL,
  headline     text NOT NULL,            -- titre de page ; le *mot* entre astérisques passe en italique accent
  summary      text NOT NULL,
  intro        text NOT NULL,
  media_label  text NOT NULL,            -- libellé du visuel (placeholder tant que les photos manquent)
  position     integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE categories IS 'Catégories de prestations (§6). Affichées dans le méga-menu et sur /prestations.';

-- Prestations (modèle du §6). category_id NULL = « hors catégories » (consultation, départ de locks).
CREATE TABLE services (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                    text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category_id             bigint REFERENCES categories (id) ON DELETE SET NULL,
  name                    text NOT NULL,
  summary                 text NOT NULL,                       -- description courte
  body                    jsonb NOT NULL DEFAULT '[]',         -- description longue : [{ title, paragraphs[] }]
  duration_min_minutes    integer NOT NULL CHECK (duration_min_minutes > 0),
  duration_max_minutes    integer NOT NULL,
  buffer_after_minutes    integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  price_cents             integer CHECK (price_cents >= 0),    -- NULL si sur devis
  price_from              boolean NOT NULL DEFAULT false,      -- « à partir de »
  on_quote                boolean NOT NULL DEFAULT false,      -- sur devis
  deposit_cents           integer CHECK (deposit_cents >= 0),  -- acompte (phase future)
  active                  boolean NOT NULL DEFAULT true,
  bookable_online         boolean NOT NULL DEFAULT true,
  allergy_test_required   boolean NOT NULL DEFAULT false,      -- test d'allergie 48 h avant (coloration)
  featured                boolean NOT NULL DEFAULT false,
  position                integer NOT NULL DEFAULT 0,
  is_placeholder          boolean NOT NULL DEFAULT true,       -- prix et durées d'exemple (badge « à confirmer » en admin)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_duration_order CHECK (duration_max_minutes >= duration_min_minutes),
  CONSTRAINT services_quote_has_no_price CHECK (NOT on_quote OR price_cents IS NULL)
);
CREATE INDEX services_category_idx ON services (category_id, position);
COMMENT ON TABLE services IS 'Prestations. Durée bloquée au planning = durée max + options + tampon (§7.3).';
COMMENT ON COLUMN services.is_placeholder IS 'Prix et durées d''exemple, à faire valider par la propriétaire (§6).';

-- Options et suppléments d'une prestation (longueur, extensions…).
CREATE TABLE service_options (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id      bigint NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  label           text NOT NULL,
  price_cents     integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  extra_minutes   integer NOT NULL DEFAULT 0 CHECK (extra_minutes >= 0),
  position        integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  is_placeholder  boolean NOT NULL DEFAULT true,
  UNIQUE (service_id, label)
);
COMMENT ON TABLE service_options IS 'Suppléments (§6) : ajoutent un prix et, au besoin, du temps au rendez-vous.';

-- Photos d'une prestation. image_path est NULL tant que les vraies photos ne sont pas importées (§12).
CREATE TABLE service_photos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id  bigint NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  caption     text NOT NULL,           -- légende, aussi utilisée comme texte alternatif
  image_path  text,
  position    integer NOT NULL DEFAULT 0
);
CREATE INDEX service_photos_service_idx ON service_photos (service_id, position);

-- Méthodes de locks (comb coils, interlocking, palm rolling…). service_id : la prestation qui la présente.
CREATE TABLE methods (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name            text NOT NULL,
  aka             text NOT NULL DEFAULT '',          -- nom français courant
  family          text NOT NULL CHECK (family IN ('installation', 'maintenance', 'both')),
  featured        boolean NOT NULL DEFAULT false,
  summary         text NOT NULL,
  principle       text NOT NULL,
  ideal_for       text NOT NULL,
  duration_label  text NOT NULL,                     -- texte libre, ex. « 3 à 5 h »
  maturation      text NOT NULL,
  maintenance     text NOT NULL,
  pros            text[] NOT NULL DEFAULT '{}',
  watchouts       text[] NOT NULL DEFAULT '{}',
  service_id      bigint REFERENCES services (id) ON DELETE SET NULL,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE methods IS 'Guide des méthodes (/methodes). Ne jamais écrire « Sisterlocks™ » (§6).';

-- Méthodes proposées pour une prestation (n-n), dans l'ordre d'affichage.
CREATE TABLE service_methods (
  service_id  bigint NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  method_id   bigint NOT NULL REFERENCES methods (id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (service_id, method_id)
);
CREATE INDEX service_methods_method_idx ON service_methods (method_id);

-- Questions fréquentes : soit un groupe de la page /faq, soit une prestation (jamais les deux).
CREATE TABLE faq_groups (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug      text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title     text NOT NULL,
  position  integer NOT NULL DEFAULT 0
);

CREATE TABLE faq_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id    bigint REFERENCES faq_groups (id) ON DELETE CASCADE,
  service_id  bigint REFERENCES services (id) ON DELETE CASCADE,
  question    text NOT NULL,
  answer      text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  CONSTRAINT faq_items_one_owner CHECK (num_nonnulls(group_id, service_id) = 1)
);
CREATE INDEX faq_items_group_idx ON faq_items (group_id, position);
CREATE INDEX faq_items_service_idx ON faq_items (service_id, position);

-- Déclencheurs updated_at.
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER services_updated_at   BEFORE UPDATE ON services   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER methods_updated_at    BEFORE UPDATE ON methods    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
