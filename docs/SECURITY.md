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

- [ ] Mots de passe argon2id — phase 6
- [ ] 2FA TOTP obligatoire + codes de secours — phase 6
- [ ] Sessions serveur en base, cookie HttpOnly / Secure / SameSite=Strict, rotation à la connexion, expiration d'inactivité — phase 6
- [ ] Verrouillage progressif après échecs — phase 6

## Contrôle d'accès (A01)

- [ ] Rôles vérifiés sur chaque route admin, avec tests — phase 6
- [x] `/styleguide` désactivé par défaut en production, `noindex` — test `app.test.js`

## Formulaires publics

- [x] CSRF (`@fastify/csrf-protection`, cookie signé HttpOnly SameSite=Lax) sur la réservation et « Gérer mon RDV » — test `routes.test.js` (contact : phase suivante)
- [x] Rate limiting sur la réservation (`BOOKING_RATE_LIMIT` / 10 min / IP), les créneaux, « Gérer mon RDV » et le flux iCal — test `routes.test.js`
- [ ] Rate limiting : login, contact, avis — phases 5 et 6
- [x] Pot de miel + preuve de travail maison sur le principe d'ALTCHA (HMAC, expiration, usage unique, sans tiers ni cookie) — tests `helpers.test.js`, `routes.test.js`

## Jetons et uploads

- [x] Jetons « gérer mon RDV » : 32 octets, SHA-256 en base, expirent 30 jours après le RDV ; pages `no-store`, `noindex`, `Referrer-Policy: no-referrer` — tests
- [ ] Jetons « laisser un avis » — phase 5
- [x] Photo des cheveux : magic bytes, 8 Mo max, garde-fou pixels, ré-encodage sharp en WebP, EXIF supprimé, nom UUID, `UPLOAD_DIR` hors webroot, jamais servie publiquement — tests
- [ ] Uploads admin (photos de galerie) — phase 6

## Secrets, logs, dépendances

- [x] Secrets uniquement par variables d'environnement ; `.env` ignoré par git ; `.env.example` documenté
- [x] `SESSION_SECRET` ≥ 32 caractères exigé au démarrage
- [x] Logs : en-têtes `cookie` et `authorization` masqués ; événements de réservation journalisés par identifiant, sans donnée personnelle
- [x] Flux iCal privé : secret ≥ 32 caractères (`ICAL_FEED_TOKEN`), comparaison à temps constant, prénom + initiale uniquement
- [ ] Journal d'audit des actions admin — phase 6
- [ ] `npm audit` en CI + Dependabot / Renovate — phase 7

## Exploitation

- [ ] Sauvegardes quotidiennes chiffrées + test de restauration documenté — phase 8
- [x] Base locale liée à 127.0.0.1 uniquement (`docker-compose.yml`)
- [ ] Revue OWASP Top 10 complète — phase 7
