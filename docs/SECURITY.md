# Sécurité : checklist

> Exigences du §13 du cahier des charges + OWASP Top 10 (2021). Cocher seulement ce qui est **en place et testé**.
> Revue complète en phase 7.

## En-têtes et transport

- [x] `@fastify/helmet` actif (nosniff, frame-ancestors 'none', referrer-policy) — test `app.test.js`
- [x] CSP stricte à nonces, sans `unsafe-inline` en production — test `app.test.js`
- [x] HSTS (2 ans, includeSubDomains, preload) en production
- [ ] HTTPS de bout en bout (Caddy) — phase 8
- [x] Aucun attribut `style=""` ni gestionnaire `on*=` dans les templates (compatibilité CSP)

## Entrées et données (A03 Injection)

- [x] Requêtes SQL paramétrées uniquement (`pool.js`, `migrate.js`)
- [x] Échappement automatique Eta (`autoEscape: true`)
- [x] Configuration validée par Zod au démarrage (`config.js`)
- [x] Validation Zod des entrées des routes publiques et de réservation (`booking/schemas.js`) — tests `helpers.test.js`, `routes.test.js`
- [ ] Schémas Zod partagés front / back : non retenu (le navigateur fait des contrôles de confort, le serveur reste seul juge)

## Authentification admin (A07)

- [x] Mots de passe argon2id (`@node-rs/argon2`, 12 caractères minimum), réponse identique pour un compte inconnu, vérification factice pour égaliser les durées — tests `auth/crypto.test.js`, `auth/routes.test.js`
- [x] 2FA TOTP obligatoire (RFC 6238, vecteurs de la RFC testés), secret chiffré AES-256-GCM au repos, code non rejouable, 10 codes de secours hachés (HMAC) à usage unique — tests
- [x] Sessions serveur en base (jeton de 32 octets, empreinte SHA-256), cookie HttpOnly, SameSite=Strict, Secure + préfixe `__Host-` en production, **identifiant renouvelé** après le mot de passe puis après la 2FA, expiration à 30 min d'inactivité et 12 h au plus, changement de mot de passe = autres sessions fermées — tests
- [x] Verrouillage progressif : 5 échecs, puis 1, 5, 15, 60 min (mots de passe et codes comptés ensemble) — tests
- [x] Limitation de débit des connexions, de la 2FA et du compte (`ADMIN_LOGIN_RATE_LIMIT`, 10 / 10 min / IP)
- [x] Création du premier compte par script (`npm run admin:create`), mot de passe saisi masqué, jamais en argument — test `scripts/create-admin.test.js`

## Contrôle d'accès (A01)

- [x] **Rôle déclaré sur chaque route /admin** (`owner`, `staff`) ; une route sans rôle est refusée. Le test `admin/access.test.js` lit la liste réelle des routes et prouve : non connecté → 401, session sans 2FA → 401, session expirée ou compte désactivé → 401, équipe sur route propriétaire → 403, écriture sans jeton CSRF → 403
- [x] Réservé à la propriétaire : prestations et tarifs, contenus, réglages, journaux, export CSV, suppression RGPD, suppression de photo
- [x] Pages privées : `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`
- [x] `/styleguide` désactivé par défaut en production, `noindex` — test `app.test.js`

## Formulaires publics

- [x] CSRF (`@fastify/csrf-protection`, cookie signé HttpOnly SameSite=Lax) sur la réservation et « Gérer mon RDV » — test `routes.test.js` (contact : phase suivante)
- [x] Rate limiting sur la réservation (`BOOKING_RATE_LIMIT` / 10 min / IP), les créneaux, « Gérer mon RDV » et le flux iCal — test `routes.test.js`
- [x] Rate limiting : login et 2FA (phase 6), avis (phase 5)
- [ ] Rate limiting : contact — formulaire pas encore branché
- [x] Pot de miel + preuve de travail maison sur le principe d'ALTCHA (HMAC, expiration, usage unique, sans tiers ni cookie) — tests `helpers.test.js`, `routes.test.js`

## Jetons et uploads

- [x] Jetons « gérer mon RDV » : 32 octets, SHA-256 en base, expirent 30 jours après le RDV ; pages `no-store`, `noindex`, `Referrer-Policy: no-referrer` — tests
- [x] Jetons « laisser un avis » : 32 octets, SHA-256 en base, usage unique, 30 jours (phase 5)
- [x] Photo des cheveux : magic bytes, 8 Mo max, garde-fou pixels, ré-encodage sharp en WebP, EXIF supprimé, nom UUID, `UPLOAD_DIR` hors webroot, jamais servie publiquement — tests
- [x] Uploads admin (galerie) : magic bytes, 8 Mo, garde-fou pixels, ré-encodage sharp (1600 px + 600 px, EXIF supprimé), nom UUID, hors webroot, diffusion limitée aux noms UUID — tests `admin/flows.test.js`
- [x] Photos des cheveux et photos d'avis non publiées : servies seulement derrière l'authentification, noms revalidés

## Secrets, logs, dépendances

- [x] Secrets uniquement par variables d'environnement ; `.env` ignoré par git ; `.env.example` documenté
- [x] `SESSION_SECRET` ≥ 32 caractères exigé au démarrage
- [x] Logs : en-têtes `cookie` et `authorization` masqués ; événements de réservation journalisés par identifiant, sans donnée personnelle
- [x] Flux iCal privé : secret ≥ 32 caractères (`ICAL_FEED_TOKEN`), comparaison à temps constant, prénom + initiale uniquement
- [x] Journal d'audit en ajout seul (déclencheur SQL), sans mot de passe, code ni secret (filtre testé), notifications_log avec destinataires masqués à l'affichage
- [x] Export CSV protégé contre l'injection de formules, accès journalisé
- [x] Suppression RGPD par anonymisation : identité, notes, photos (fichiers effacés), jetons et destinataires des messages — test `admin/flows.test.js`
- [ ] `npm audit` en CI + Dependabot / Renovate — phase 7

## Exploitation

- [ ] Sauvegardes quotidiennes chiffrées + test de restauration documenté — phase 8
- [x] Base locale liée à 127.0.0.1 uniquement (`docker-compose.yml`)
- [ ] Revue OWASP Top 10 complète — phase 7
