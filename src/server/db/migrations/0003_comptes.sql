-- 0003 : comptes de l'administration et sessions (§9, §13).
-- Mots de passe : argon2id (hash complet dans password_hash). 2FA TOTP obligatoire : le secret est
-- chiffré par l'application (clé dans l'environnement), jamais stocké en clair.
CREATE TABLE users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  citext NOT NULL UNIQUE,
  display_name           text NOT NULL,
  password_hash          text NOT NULL,
  role                   text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
  totp_secret_encrypted  text,                            -- NULL tant que la 2FA n'est pas configurée
  totp_confirmed_at      timestamptz,
  recovery_code_hashes   text[] NOT NULL DEFAULT '{}',    -- codes de secours hashés, à usage unique
  failed_login_count     integer NOT NULL DEFAULT 0,      -- verrouillage progressif
  locked_until           timestamptz,
  last_login_at          timestamptz,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE users IS 'Comptes admin (propriétaire, futures employées). Rôles vérifiés sur chaque route /admin (§13).';

-- Sessions côté serveur. Le cookie contient un jeton aléatoire ; on ne stocke que son empreinte SHA-256.
CREATE TABLE sessions (
  token_hash    bytea PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mfa_verified  boolean NOT NULL DEFAULT false,         -- false entre le mot de passe et le code TOTP
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ip            inet,
  user_agent    text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);   -- purge des sessions expirées
COMMENT ON TABLE sessions IS 'Sessions serveur (cookie HttpOnly/Secure/SameSite). Purge : expires_at < now().';

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
