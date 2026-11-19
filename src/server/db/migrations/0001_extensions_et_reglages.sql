-- 0001 : extensions et table de réglages du salon.
-- btree_gist : nécessaire à la contrainte anti-double-réservation (EXCLUDE USING gist, phase 4).
-- citext     : emails insensibles à la casse.
-- pgcrypto   : gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Réglages clé/valeur éditables en admin (coordonnées, délais, politique d'annulation…).
CREATE TABLE settings (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]+$'),
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE settings IS 'Réglages du salon, éditables en admin (§9 Réglages).';
