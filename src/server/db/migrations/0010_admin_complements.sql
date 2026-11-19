-- 0010 : compléments du back-office (phase 6).
-- * users.totp_last_step : pas TOTP déjà consommé (un code ne sert qu'une fois, même dans sa fenêtre).
-- * appointments.source : rendez-vous pris en ligne ou saisi par le salon (téléphone, WhatsApp).
-- * gallery_items.alt_text : texte alternatif obligatoire, distinct du titre.
ALTER TABLE users ADD COLUMN totp_last_step bigint;

ALTER TABLE appointments
  ADD COLUMN source text NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'admin'));

ALTER TABLE gallery_items ADD COLUMN alt_text text;
UPDATE gallery_items SET alt_text = title WHERE alt_text IS NULL;
ALTER TABLE gallery_items
  ALTER COLUMN alt_text SET NOT NULL,
  ADD CONSTRAINT gallery_items_alt_not_blank CHECK (length(btrim(alt_text)) > 0);
COMMENT ON COLUMN gallery_items.alt_text IS 'Texte alternatif de la photo (accessibilité, SEO) : obligatoire.';
