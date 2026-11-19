-- Purge des adresses IP du journal d'audit (RGPD, 12 mois) : le journal reste en ajout seul,
-- la seule modification permise est de mettre `ip` à NULL.
CREATE OR REPLACE FUNCTION audit_log_forbid_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ip IS NULL
     AND (to_jsonb(NEW) - 'ip') = (to_jsonb(OLD) - 'ip') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log est en ajout seul : modification interdite';
END;
$$;
