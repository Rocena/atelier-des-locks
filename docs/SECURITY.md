# Sécurité : checklist

> Exigences du §13 du cahier des charges + OWASP Top 10 (2021). Cocher seulement ce qui est **en place et testé**.
> Revue OWASP Top 10 réalisée en phase 7 (auditeur indépendant, constats corrigés ci-dessous).

## En-têtes et transport

- [x] `@fastify/helmet` actif (nosniff, frame-ancestors 'none', referrer-policy) — test `app.test.js`
- [x] CSP stricte à nonces, sans `unsafe-inline` en production — test `app.test.js`
- [x] HSTS (2 ans, includeSubDomains, preload) en production
- [x] HTTPS de bout en bout (Caddy) : testé en local (redirection, HSTS, CSP) ; certificat réel à confirmer au premier démarrage
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
- [x] Logs : en-têtes `cookie` et `authorization` masqués, **URL sans jeton ni paramètres** (`/rdv/[jeton]`, `/avis/laisser/[jeton]`, `/agenda/[jeton]`, plus de `?_csrf=`), adresse IP non journalisée ; événements de réservation par identifiant — test `app.test.js`
- [x] Caddy : journal sans IP, en-têtes, jetons ni paramètres — testé (`/rdv/<jeton>?x=1` journalisé `/rdv/`)
- [x] Flux iCal privé : secret ≥ 32 caractères (`ICAL_FEED_TOKEN`), comparaison à temps constant, prénom + initiale uniquement
- [x] Journal d'audit en ajout seul (déclencheur SQL), sans mot de passe, code ni secret (filtre testé), notifications_log avec destinataires masqués à l'affichage
- [x] Export CSV protégé contre l'injection de formules, accès journalisé
- [x] Suppression RGPD par anonymisation : identité, notes, photos (fichiers effacés), jetons et destinataires des messages — test `admin/flows.test.js`
- [x] `npm audit` : 0 vulnérabilité ; CI GitHub (`.github/workflows/ci.yml`) avec `npm audit --audit-level=high`, audit hebdomadaire, Dependabot (`.github/dependabot.yml`)

## Exploitation

- [x] Sauvegardes quotidiennes chiffrées (age, clé publique sur le serveur, clé privée hors serveur, copies en clair en tmpfs) ; `restore verify` **testé** (effectifs vérifiés, mauvaise clé refusée) ; procédure documentée (`DEPLOIEMENT.md`, étape 12)
- [x] Restauration réelle (`restore.sh live`) testée en local ; copie hors serveur : écrite, à tester au premier déploiement
- [x] Base locale liée à 127.0.0.1 uniquement (`docker-compose.yml`)
- [x] Production : aucun port publié pour la base ni l'application (seul Caddy : 80/443), réseau de la base `internal`, conteneurs non-root / lecture seule / `cap_drop: ALL` (`docker-compose.prod.yml`)
- [x] Revue OWASP Top 10 complète (phase 7) : aucune faille critique ; constats ci-dessous

## Revue de phase 7 (OWASP Top 10, 2021)

Auditeur indépendant (sous-agent, code relu sans modification), puis corrections :

- [x] **A01/A04 : écrasement de fiche** : réserver avec l'email d'une cliente ne modifie plus son nom, son téléphone ni ses SMS (seule une fiche anonymisée est refaite) ; l'adresse `@sans-email.invalid` est refusée au public — tests `booking/routes.test.js`
- [x] **A04 : plafond de RDV** : 3 rendez-vous à venir au plus par email (429), en plus de la limite par IP. Pas de plafond par téléphone (numéros partagés en famille)
- [x] **A05 : gestionnaire d'erreur** : les erreurs 500 sont journalisées avec l'identifiant de requête et renvoient un message générique (page HTML ou JSON) ; une `ZodError` donne 400 — test `app.test.js`
- [x] **A05 : `trustProxy`** limité aux proxys listés (`TRUST_PROXY`, défaut 127.0.0.1 et ::1) ; le port de l'application ne doit pas être exposé (phase 8)
- [x] **A05/A02 : configuration de production** : le démarrage échoue si le secret est court ou d'exemple, si `PUBLIC_URL` n'est pas en https, si la base utilise le mot de passe de développement ou si le fournisseur d'envoi est `console` — tests `config.test.js`
- [x] **A05 : `Permissions-Policy`** fermée (caméra, micro, géolocalisation, paiement, USB)
- [x] **A09 : RGPD et journaux** : purge planifiée (sessions expirées, IP à 12 mois — le déclencheur d'audit autorise seulement de mettre `ip` à NULL —, destinataires à 12 mois, photos à 1 an, clientes inactives anonymisées) — test `retention/service.test.js`
- [ ] **Résiduel, assumé** : verrouillage du compte propriétaire par un tiers (verrou par compte : 5 échecs puis 1 à 60 min ; la limite par IP freine mais n'empêche pas ; déblocage en base) ; preuve de travail légère et anti-rejeu en mémoire (réinitialisé au redémarrage, une seule instance) ; limites de débit en mémoire ; journal d'audit non protégé contre `DELETE` / `TRUNCATE` par un compte SQL compromis ; l'équipe voit toutes les clientes (règle métier à confirmer) ; cookie CSRF non lié à la session (atténué par SameSite)
- [ ] **Phase 8** : voir les cases ci-dessus (sauvegardes faites ; HTTPS et restauration réelle à valider sur la pile démarrée)
