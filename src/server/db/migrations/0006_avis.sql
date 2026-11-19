-- 0006 : avis clientes et jetons de dépôt d'avis (§8).
-- Un avis vérifié est lié à un rendez-vous terminé. Les avis d'exemple de la phase 2 n'ont pas de
-- rendez-vous : ils portent is_placeholder = true et doivent disparaître avant la mise en ligne.
CREATE TABLE reviews (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id       uuid UNIQUE REFERENCES appointments (id) ON DELETE SET NULL,   -- un avis par rendez-vous
  service_id           bigint REFERENCES services (id) ON DELETE SET NULL,
  author_name          text NOT NULL,                       -- prénom + initiale, ex. « Awa D. »
  rating               smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body                 text NOT NULL,
  photo_path           text,
  consent_publication  boolean NOT NULL DEFAULT false,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  featured             boolean NOT NULL DEFAULT false,      -- mise en avant sur l'accueil
  verified             boolean NOT NULL DEFAULT false,      -- laissé après un vrai rendez-vous
  owner_reply          text,                                -- réponse publique
  replied_at           timestamptz,
  submitted_at         timestamptz NOT NULL DEFAULT now(),
  is_placeholder       boolean NOT NULL DEFAULT false,
  CONSTRAINT reviews_publish_needs_consent CHECK (status <> 'approved' OR consent_publication),
  CONSTRAINT reviews_verified_needs_appointment CHECK (NOT verified OR appointment_id IS NOT NULL OR is_placeholder)
);
CREATE INDEX reviews_public_idx ON reviews (status, submitted_at DESC);
CREATE INDEX reviews_service_idx ON reviews (service_id);
COMMENT ON TABLE reviews IS 'Avis, modérés en admin (approuver, refuser, répondre, mettre en avant). Lecture publique : status = approved.';

-- Jeton du lien « laisser un avis » : usage unique, expire à 30 jours (§8). Seule l'empreinte est stockée.
CREATE TABLE review_tokens (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  appointment_id    uuid NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  token_hash        bytea NOT NULL UNIQUE,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  reminder_sent_at  timestamptz,                            -- relance unique à J+5 (§7.6)
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_tokens_appointment_idx ON review_tokens (appointment_id);
COMMENT ON TABLE review_tokens IS 'Jetons de dépôt d''avis : ≥ 32 octets aléatoires, hashés, usage unique, 30 jours.';
