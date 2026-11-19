-- 0007 : galerie, étiquettes, journal « Conseils » et blocs de contenu éditables (§5, §9, §12).

-- Étiquettes transverses : taille de locks (galerie), thème d'article…
CREATE TABLE tags (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind      text NOT NULL CHECK (kind IN ('size', 'topic')),
  slug      text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label     text NOT NULL,
  position  integer NOT NULL DEFAULT 0,
  UNIQUE (kind, slug)
);
COMMENT ON TABLE tags IS 'Étiquettes : kind = size (taille des locks, filtre de la galerie) ou topic (thème d''un article).';

-- Réalisations de la galerie. image_path est NULL tant que les photos d'origine ne sont pas importées
-- (aucune photo récupérée sur le web) : la page affiche alors un placeholder de marque.
CREATE TABLE gallery_items (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title           text NOT NULL,                  -- aussi texte alternatif
  category_id     bigint REFERENCES categories (id) ON DELETE SET NULL,
  method_id       bigint REFERENCES methods (id) ON DELETE SET NULL,
  ratio           text NOT NULL DEFAULT 'portrait' CHECK (ratio IN ('portrait', 'landscape', 'square')),
  image_path      text,
  featured        boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  position        integer NOT NULL DEFAULT 0,
  is_placeholder  boolean NOT NULL DEFAULT true,  -- visuel provisoire
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gallery_items_filter_idx ON gallery_items (category_id, method_id);

CREATE TABLE gallery_item_tags (
  item_id  bigint NOT NULL REFERENCES gallery_items (id) ON DELETE CASCADE,
  tag_id   bigint NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX gallery_item_tags_tag_idx ON gallery_item_tags (tag_id);

-- Articles du journal (/conseils). Contenu en sections : [{ title|null, paragraphs[] }].
CREATE TABLE articles (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            text NOT NULL,                 -- un *mot* entre astérisques passe en italique accent
  plain_title      text NOT NULL,                 -- sans balisage (balise title, JSON-LD)
  excerpt          text NOT NULL,
  sections         jsonb NOT NULL DEFAULT '[]',
  reading_minutes  integer NOT NULL CHECK (reading_minutes > 0),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_on     date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT articles_published_has_date CHECK (status <> 'published' OR published_on IS NOT NULL)
);
CREATE INDEX articles_public_idx ON articles (status, published_on DESC);

CREATE TABLE article_tags (
  article_id  bigint NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  tag_id      bigint NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);
CREATE INDEX article_tags_tag_idx ON article_tags (tag_id);

-- Blocs de contenu éditables en admin (textes de pages, étapes de maturation des locks…).
-- La clé est stable (ex. « methods.stages ») ; le corps est du JSON structuré propre à chaque bloc.
CREATE TABLE content_blocks (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]+$'),
  title       text NOT NULL,
  body        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users (id) ON DELETE SET NULL
);
COMMENT ON TABLE content_blocks IS 'Textes éditables hors catalogue : un bloc par clé, lu par le module content.';

CREATE TRIGGER gallery_items_updated_at  BEFORE UPDATE ON gallery_items  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER articles_updated_at       BEFORE UPDATE ON articles       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER content_blocks_updated_at BEFORE UPDATE ON content_blocks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
