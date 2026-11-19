-- 0009 : idempotence des envois (§7.6).
-- Un job pg-boss peut être rejoué (retry, redémarrage du serveur) : la clé de dédoublonnage
-- garantit qu'un même message n'est jamais envoyé deux fois par canal, et que seul le canal
-- en échec est retenté (l'email est parti, le SMS non : on ne renvoie que le SMS).
ALTER TABLE notifications_log ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX notifications_log_dedupe_idx ON notifications_log (dedupe_key, channel)
  WHERE dedupe_key IS NOT NULL;
COMMENT ON COLUMN notifications_log.dedupe_key IS 'Identifie un message logique (ex. reminder_d2:<rdv>:<début>). Unique par canal.';

-- Les photos des avis vivent dans UPLOAD_DIR/reviews/ ; l'avis publié les sert via /avis/photos/:id.
-- Index de la modération (file « à modérer »).
CREATE INDEX reviews_pending_idx ON reviews (submitted_at) WHERE status = 'pending';
