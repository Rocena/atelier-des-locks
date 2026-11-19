# Module `auth`

- **Rôle** : connexion à l'admin : mot de passe (argon2id), 2FA TOTP obligatoire, codes de secours, sessions en base.
- **Pur** : `totp.js` (RFC 6238), `lockout.js` (verrouillage progressif), `password.js`, `crypto.js` (secrets au repos, jetons).
- **Service** : `login` → `verifySecondFactor` / `confirmTotpSetup` → `authenticate`. L'identifiant de session est renouvelé à chaque niveau.
- **Routes** : `/admin/connexion`, `/verification`, `/2fa`, `/deconnexion`, `/compte`.
- **Script** : `npm run admin:create` crée le premier compte propriétaire.
- **Sécurité** : réponse identique compte inconnu / mauvais mot de passe / compte verrouillé ; aucun secret dans l'audit.
