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
- [ ] Validation Zod de toutes les entrées de routes — dès la phase 3
- [ ] Schémas Zod partagés front / back — phase 4

## Authentification admin (A07)

- [ ] Mots de passe argon2id — phase 6
- [ ] 2FA TOTP obligatoire + codes de secours — phase 6
- [ ] Sessions serveur en base, cookie HttpOnly / Secure / SameSite=Strict, rotation à la connexion, expiration d'inactivité — phase 6
- [ ] Verrouillage progressif après échecs — phase 6

## Contrôle d'accès (A01)

- [ ] Rôles vérifiés sur chaque route admin, avec tests — phase 6
- [x] `/styleguide` désactivé par défaut en production, `noindex` — test `app.test.js`

## Formulaires publics

- [ ] CSRF (`@fastify/csrf-protection`) — phase 4
- [ ] Rate limiting (`@fastify/rate-limit`) : login, réservation, contact, avis — phases 4 à 6
- [ ] Honeypot + anti-bot respectueux (ALTCHA ou Turnstile) — phase 4

## Jetons et uploads

- [ ] Jetons « gérer mon RDV » / « laisser un avis » : ≥ 32 octets, stockés hashés, expirants — phases 4–5
- [ ] Uploads : magic bytes, taille max, ré-encodage sharp, EXIF supprimé, noms aléatoires, hors webroot — phase 6

## Secrets, logs, dépendances

- [x] Secrets uniquement par variables d'environnement ; `.env` ignoré par git ; `.env.example` documenté
- [x] `SESSION_SECRET` ≥ 32 caractères exigé au démarrage
- [x] Logs : en-têtes `cookie` et `authorization` masqués
- [ ] Journal d'audit des actions admin — phase 6
- [ ] `npm audit` en CI + Dependabot / Renovate — phase 7

## Exploitation

- [ ] Sauvegardes quotidiennes chiffrées + test de restauration documenté — phase 8
- [x] Base locale liée à 127.0.0.1 uniquement (`docker-compose.yml`)
- [ ] Revue OWASP Top 10 complète — phase 7
