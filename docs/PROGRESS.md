# Journal d'avancement

> À lire en début de session, à mettre à jour en fin de phase.
> Phases : cf. §17 du cahier des charges.

## État actuel

| Phase                     | Statut                                                                          | Critère de fin                                        |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 0 · Mise en place         | ✅ terminée (2026-11-19)                                                        | `npm run dev`, lint et tests passent                  |
| 1 · Design system         | ✅ terminée (2026-11-19), en attente de validation visuelle par la propriétaire | Styleguide validé (captures dans `docs/screenshots/`) |
| 2 · Pages publiques       | ✅ terminée (2026-11-19), contenus seed à valider par la propriétaire           | Pages du §5, budgets §16 (Lighthouse mobile)          |
| 3 · Base de données       | ✅ terminée (2026-11-19)                                                        | Seeds JSON migrés en tables, `docs/DATABASE.md`       |
| 4 · Réservation           | ✅ terminée (2026-11-19), règles de prestation longue à valider                 | Tests du moteur, e2e réservation                      |
| 5 · Notifications et avis | ✅ terminée (2026-11-19), Brevo à tester avec une vraie clé                     | Tests de planification des jobs                       |
| 6 · Back-office           | ✅ terminée (2026-11-19), à essayer sur téléphone par la propriétaire           | Contrôle d'accès prouvé, e2e des parcours principaux  |
| 7 · Durcissement          | ✅ terminée (2026-11-19) ; performance à re-mesurer sur une machine saine       | Checklists `SECURITY.md` et accessibilité             |

## Phase 0 : fait

- Dépôt git, Node 22+ (testé sur Node 24), ESM, ESLint (flat config) + Prettier, Husky + lint-staged, `jsconfig.json` (`checkJs`, `strict`).
- Fastify 5 : `config.js` (Zod), helmet avec **CSP à nonces**, HSTS en production, `reply.page()` (Eta + assets Vite), 404 HTML/JSON.
- Vite 8 multi-pages : entrées déclarées dans `src/client/entries.js` (un CSS + un JS par page). En dev : Vite en middleware (HMR sur `PORT + 21000`). En prod : manifest, cache long sur `/assets/`, préchargement de Bodoni et Manrope.
- PostgreSQL 17 (`docker-compose.yml`, volume nommé, port lié à 127.0.0.1), `db:migrate` (sommes de contrôle, une transaction par fichier), `db:seed` (idempotent, refusé en production). Migration 0001 : `btree_gist`, `citext`, `pgcrypto`, table `settings`.
- Tests : Vitest (13 tests : config, en-têtes de sécurité, nonce, échappement, styleguide désactivable), Playwright (9 tests desktop 1440 et mobile 390 : chargement sans erreur, pas de défilement horizontal, thème, lien d'évitement, erreurs reliées aux champs, menu mobile au clavier).
- Docs : `CLAUDE.md`, `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, `SECURITY.md` (checklist), ADR 0001.

## Phase 1 : fait

- **Tokens** (`src/client/styles/tokens.css`) : palette BRAND.md en OKLCH, déclinaisons, tokens sémantiques clair et sombre (+ `data-surface="ebene"` pour les sections sombres), typo fluide `clamp()` (ratio 1,2 → 1,333), espacements base 4/8, rayons, ombres teintées, durées et courbes.
- **Contrastes** : `npm run check:contrast` vérifie 16 paires × 2 thèmes. Tout passe en WCAG AA.
- **Polices** auto-hébergées (Fontsource) : Bodoni Moda (axe opsz, droit et italique), Manrope.
- **Composants** : boutons (primaire, secondaire, discret ; tailles ; survol, focus, pression, désactivé, chargement), liens, badges de statut, champs (aide, erreur, succès, désactivé, select, textarea, cases), carte prestation (révélation au survol, variante arche, sur devis), header sticky rétractable, menu mobile plein écran (focus piégé, Échap), footer ébène, arche photo (soleil, filet laiton, révélation clip-path), placeholder de marque, **fil de loc** SVG strié dessiné au scroll, grain papier, trame bogolan, bascule clair/sombre.
- **/styleguide** : 14 sections, états forcés visibles, clair et sombre. Accueil provisoire « L'art de la _loc_, à Toulouse. ».
- **Revue visuelle** (design-craft §10), deux passes sur les captures 1440 et 390. Corrigé :
  - arches aplaties ;
  - bogolan trop présent ;
  - titres des cartes décalés ;
  - label des placeholders rogné ;
  - select étiré ;
  - échantillons typo tronqués ;
  - icône sombre réduite à un point ;
  - fil qui chevauchait le titre sur mobile ;
  - débordement horizontal (soleil de l'arche, colonnes de grille implicites) ;
  - lien d'évitement visible ;
  - libellé du bouton de thème écrasé par un `aria-label`.

## Phase 2 : fait

- **Pages** (§5) : accueil, `/le-salon`, `/prestations`, `/prestations/:slug` (16 prestations), `/methodes`, `/galerie`, `/tarifs`, `/avis`, `/conseils` (+ 3 articles), `/faq`, `/contact`, `/reserver` (vitrine de la 1re étape, le tunnel arrive plus tard), `/mentions-legales`, `/confidentialite`, `/cgv-politique-rdv`, 404. Plus `sitemap.xml` et `robots.txt`.
- **Données seed JSON** dans `src/server/db/seeds/*.json` (prestations et catégories, méthodes, galerie, avis, articles, FAQ, réglages). Lues **uniquement** par les `repo.js` via `db/json-store.js` : en phase 3, seuls les repos changent.
- **Modules** : `catalog` (prestations, méthodes, tarifs), `gallery`, `reviews`, `journal`, `site` (accueil, pages éditoriales, légal, SEO). Métier en fonctions pures testées (regroupement, suggestions, méga-menu, filtres de galerie, moyenne des avis, JSON-LD, sitemap).
- **Accueil** exactement selon le déroulé du §5 (10 sections), avec les **7 signatures** du §15 :
  1. fil de loc piloté par ScrollTrigger (manifeste, parcours) ;
  2. titres révélés ligne par ligne (SplitText, masque) ; le titre du hero est révélé en CSS pur (LCP) ;
  3. arches révélées en `clip-path` + léger parallax ;
  4. carrousel des méthodes épinglé et piloté par le scroll (≥ 1024 px ; glissable au doigt en dessous ; panneau amené à l'écran au focus clavier) ;
  5. View Transitions entre documents (fondu + glissement du titre `.page-title`) ;
  6. boutons magnétiques et curseur discret (pointeur fin uniquement, curseur natif conservé) ;
  7. loader d'entrée en CSS pur (≤ 1,2 s, une fois par session) : soleil qui se lève, puis l'emblème.
- **Chargement à la demande** : Lenis (5,5 ko gzip) et GSAP + ScrollTrigger + SplitText (48 ko gzip) ne se chargent qu'à la **première interaction** (scroll, pointeur, clavier). JS initial de l'accueil : ~4 ko gzip.
- **Navigation à la raissadora** : bandeau d'annonce (éditable, masquable, mémorisé par id), header sticky rétractable, méga-menu « Prestations » (survol avec délai d'intention, clavier, Échap), tiroir mobile avec sous-catégories et liens secondaires, fil d'Ariane (microdonnées `BreadcrumbList`) sur les pages profondes, barre « Réserver » collante en bas sur mobile et tablette.
- **`prefers-reduced-motion`** : pas de loader, pas de Lenis, pas de GSAP, fils affichés entiers, bandeau défilant figé, pas de View Transitions.
- **SEO** : title/description/canonical uniques, Open Graph avec `public/og-image.png` (`npm run og-image`), JSON-LD `HairSalon` (accueil, contact), `Service` (prestations), `Article`, `FAQPage`.
- **Compression** brotli/gzip des réponses (`@fastify/compress`).
- **Tests** : 61 tests unitaires (dont toutes les pages en 200, titres uniques, 404, sitemap, JSON-LD sûr, compression, mention Sisterlocks™) ; 45 tests e2e (chaque page sans erreur console ni défilement horizontal à 390 et 1440, méga-menu au clavier, barre Réserver, filtres et lightbox de la galerie, mouvement réduit).
- **Vérification visuelle** à 390, 768 et 1440 px, clair et sombre : captures dans `docs/screenshots/` (`npm run screenshots -- <url>`).

### Lighthouse mobile (build de production, médiane de 3 passages)

| Page                    | Perf    | A11y | Bonnes pratiques | SEO | LCP         | CLS     |
| ----------------------- | ------- | ---- | ---------------- | --- | ----------- | ------- |
| Accueil                 | 90 – 98 | 100  | 100              | 100 | 2,3 – 2,5 s | 0       |
| Prestations             | 99      | 100  | 100              | 100 | 1,0 s       | 0       |
| Prestation (détail)     | 94      | 100  | 100              | 100 | 1,1 s       | 0       |
| Méthodes                | 100     | 100  | 100              | 100 | 1,2 s       | 0       |
| Galerie, avis, le salon | 99      | 100  | 100              | 100 | ≤ 1,0 s     | 0       |
| Conseils, FAQ, contact… | 99–100  | 100  | 100              | 100 | ≤ 1,0 s     | ≤ 0,004 |

- La machine de développement est bruyante (OneDrive) : un passage isolé peut varier de ±20 points. D'où la médiane.
- **Point de vigilance** : le LCP de l'accueil est à la limite du budget (2,5 s). Lighthouse voit toujours le loader d'entrée (session neuve), qui retarde le hero de ~1 s. Les vraies photos (AVIF, `srcset`) devront être vérifiées à nouveau.
- Corrections faites pour tenir les budgets : GSAP à la première interaction, bandeau défilant en pause hors écran, calques dédiés pour le loader, filigrane de l'emblème réservé aux arches (le SVG de 61 ko coûtait cher en rendu sur les vignettes), `text-wrap: pretty` limité aux textes longs, compression.

## Phase 3 : fait

- **Schéma complet** (toutes phases), 7 nouvelles migrations commentées : catalogue (`categories`, `services`, `service_options`, `service_photos`, `methods`, `service_methods`, `faq_*`), comptes (`users`, `sessions`), planning (`staff`, `staff_services`, `opening_hours`, `closures`, `blocks`), `clients`, `appointments` + `appointment_options`, `reviews` + `review_tokens`, contenu (`tags`, `gallery_items`, `articles`, `content_blocks`), `notifications_log`, `audit_log` (ajout seul). Documenté dans `docs/DATABASE.md` (diagramme, conventions, conservation RGPD).
- **Anti-double-réservation** : `EXCLUDE USING gist (staff_id =, tstzrange(starts_at, ends_at) &&)` sur les statuts qui occupent le planning ; l'annulation libère le créneau. Prouvé par des tests (chevauchement refusé `23P01`, créneaux contigus acceptés, autre praticienne, annulé). Même garde-fou sur les plages d'ouverture.
- **Seeds JSON → base** (`db/seed-content.js`, SQL paramétré, idempotent, vérifié par test) : 5 catégories, 16 prestations, 13 options, 10 méthodes, 14 réalisations, 8 avis, 3 articles, 28 questions FAQ, réglages `site.*`, étapes de maturation (`content_blocks`), une praticienne par défaut. **Prix, durées, options, avis et visuels : `is_placeholder = true`.** `json-store.js` supprimé.
- **Modules** alignés sur le §11 : `catalog` → `services`, `journal` → `content` (absorbe aussi les réglages et la FAQ de `site`), `gallery` et `reviews` conservés. Chaque repo reçoit le pool (`app.db`), les formes de données sont inchangées : **routes et templates n'ont pas bougé**, sauf l'ajout du pool.
- **API de lecture JSON** validée par Zod : `/api/services[/:slug]`, `/api/gallery`, `/api/reviews`, `/api/articles`, `/api/content/:key`. `isPlaceholder` n'est jamais exposé.
- **Pages publiques branchées** sur la base ; données communes (méga-menu, bandeau) relues au plus toutes les 30 s.
- **Tests** : base dédiée `<base>_test` créée, migrée et seedée automatiquement (`vitest globalSetup`), fichiers exécutés en série. 84 tests unitaires et 45 e2e passent ; lint et typecheck propres.

## Phase 4 : fait

- **Moteur de disponibilités** (`modules/booking/availability.js`), fonction pure écrite en TDD (48 tests) :
  - horaires à plusieurs plages par jour ;
  - exceptions (fermetures, congés, horaires spéciaux) et blocages ;
  - prestations longues ;
  - tampon, délai minimum, horizon en date locale ;
  - Europe/Paris et changements d'heure (mars et octobre 2026, mars 2027) ;
  - plusieurs praticiennes.
- **Conversions de fuseau** sans dépendance (`lib/zoned-time.js`) : une heure inexistante est décalée vers l'avant, une heure ambiguë prend la première occurrence.
- **Politique** (`policy.js`) :
  - durée bloquée = durée max + options + tampon ;
  - prix estimé calculé en centimes ;
  - déplacement et annulation en libre-service jusqu'à `booking.cancellation_hours` avant (borne incluse).
- **API** :
  - `GET /api/booking/slots` : 42 jours au plus par requête ;
  - `GET /api/booking/challenge` ;
  - `POST /api/booking/appointments` (multipart) ;
  - `/rdv/:token` (voir, `deplacer`, `annuler`, `rdv.ics`) ;
  - `/agenda/<ICAL_FEED_TOKEN>.ics` : flux privé de la propriétaire.
- **Anti-double-réservation** : revalidation du créneau dans une transaction, puis contrainte d'exclusion. Testé avec 3 réservations simultanées du même créneau : une seule passe.
- **Sécurité** :
  - CSRF (cookie signé) et rate limit ;
  - pot de miel et preuve de travail anti-robot maison (HMAC, expiration, usage unique, sans tiers) ;
  - jetons de 32 octets hachés en SHA-256, valables jusqu'à 30 jours après le RDV ;
  - pages à jeton en `no-store`, `noindex` et `no-referrer` ;
  - photo vérifiée par magic bytes (8 Mo max), ré-encodée en WebP par sharp (EXIF supprimé), nom UUID, stockée dans `UPLOAD_DIR` hors webroot ;
  - CSP : `img-src blob:` ajouté pour l'aperçu local de la photo.
- **Adaptateur `BOOKING_PROVIDER`** :
  - avec `fresha_link`, `/reserver` fait une redirection 302 vers Fresha, l'API de création répond 404 et `/reserver` sort du sitemap ;
  - tous les boutons « Réserver » utilisent `bookingHref` ;
  - les liens « Gérer mon RDV » restent actifs.
- **Tunnel `/reserver`** (entrée Vite `booking`), en 4 étapes avec barre de progression :
  - le bouton retour du navigateur revient à l'étape précédente ;
  - récapitulatif « ticket » collant sur desktop, barre compacte en bas sur mobile ;
  - calendrier mensuel au clavier (flèches, Début/Fin, PageUp/PageDown, Entrée) ;
  - créneaux en boutons radio natifs, groupés matin / après-midi ;
  - états chargement (squelette), erreur (« Réessayer »), mois vide (« Voir le mois suivant ») et créneau pris entre-temps (retour à l'étape 2) ;
  - résumé d'erreurs relié aux champs ;
  - prestation présélectionnée depuis sa fiche (`/reserver?prestation=slug`) ;
  - prestations sur devis ou après consultation non réservables, avec lien vers le contact.
- **Gérer mon RDV** : pages serveur sans JS (ticket, déplacement semaine par semaine, annulation confirmée, page « lien expiré »).
- **Tests** :
  - unitaires : 213 (moteur, fuseau, politique, jetons, anti-bot, .ics, photo, validation, 32 tests d'intégration API) ;
  - e2e : 21 tests dans `tests/e2e/booking.spec.js` (11 desktop, 10 mobile ; le parcours au clavier est testé sur desktop), sur mobile et desktop (parcours complet avec photo, déplacement et annulation, erreurs, créneau pris, états du calendrier, présélection, clavier, axe-core WCAG A/AA) ;
  - les réservations e2e (`@e2e.test.invalid`) sont nettoyées avant et après la suite (`tests/e2e/cleanup.js`).

## Phase 5 : fait

- **Notifications** (`modules/notifications/`) :
  - interface `NotificationProvider` ; `console` (dev et tests, destinataires masqués) et `brevo` (API `/smtp/email` et `/transactionalSMS/sms`, erreurs 4xx définitives, 429 et 5xx rejouées) ;
  - jobs **pg-boss** dans PostgreSQL (schéma `pgboss`, 6 essais à délai croissant), démarrés par `index.js` ; file en mémoire en test ;
  - 7 files : confirmation, déplacement/annulation, alerte propriétaire, rappel J-2 (email, 10h), rappel J-1 (SMS, 18h), demande d'avis (terminé + 3 h), relance unique (+ 5 jours) ;
  - planification **pure** (`plan.js`, heure de Paris, changements d'heure) et garde-fous rejoués à l'exécution : RDV annulé, déplacé ou avis déjà laissé → message écarté et journalisé `skipped` ;
  - jamais de doublon : clé de dédoublonnage unique par canal (migration 0009), seul le canal en échec est retenté ;
  - jobs **sans donnée personnelle** ; le jeton « Gérer mon RDV » (haché en base) n'y figure que **chiffré** (AES-256-GCM, clé dérivée de `SESSION_SECRET`) pour les rappels ;
  - emails HTML en tableaux, responsive, aux couleurs de la marque (en-tête ébène, filet laiton, bouton terre cuite, polices de secours Bodoni 72 / Didot / Georgia et Helvetica / Segoe UI), version texte, logo en PNG (`npm run email-logo`), `.ics` joint à la confirmation et au déplacement ;
  - SMS transcodés GSM, 160 caractères maximum, lien jamais tronqué, sans « STOP » ; expéditeur `SMS_SENDER` (11 caractères alphanumériques).
- **Avis** (`modules/reviews/`) :
  - lien `/avis/laisser/:token` (32 octets, SHA-256, 30 jours, usage unique, pages `no-store` / `noindex` / `no-referrer`) ;
  - formulaire sans JavaScript : note en étoiles (boutons radio), texte, prénom + initiale, photo facultative (magic bytes, WebP via sharp, `UPLOAD_DIR/reviews/`), consentement obligatoire, CSRF, pot de miel, limitation de débit ;
  - dépôt transactionnel : avis `pending` (« à modérer »), `verified`, jeton consommé ; deux envois simultanés ne créent qu'un avis ;
  - publics : `/avis` (note moyenne, répartition, photo, réponse de la propriétaire, lien Google `GOOGLE_REVIEW_URL`), avis par prestation, blocs masqués tant qu'il n'y a aucun avis (accueil) ou « Les premiers avis arrivent bientôt » (`/avis`) ; photos servies par `/avis/photos/:id` **uniquement si l'avis est approuvé**.
- **Branchement** : création, déplacement et annulation appellent `app.notifications.*` (qui ne lève jamais d'erreur : la réservation est déjà enregistrée). `appointmentCompleted` est prêt pour l'admin.
- **Tests** : 289 tests unitaires (dont 29 de planification, 19 de messages et fournisseurs, 11 de cycle de vie avec base, 17 sur les avis) ; lint, typecheck et build propres. e2e non relancés.

## Phase 6 : fait

Back-office complet sous `/admin`, rendu serveur (Eta) et JavaScript en amélioration, **mobile d'abord** (barre d'onglets en bas, listes tactiles, aucune page qui défile à l'horizontale à 390 px), même identité que le site en plus sobre. Décisions : `docs/decisions/0002-admin-auth-and-access.md`.

### Authentification et accès (§13)

- **Connexion** : mot de passe (**argon2id**) → code **TOTP** (RFC 6238, testé avec les vecteurs de la RFC) ou **code de secours** (10 codes hachés, à usage unique). 2FA **obligatoire** : à la première connexion, QR code + clé de saisie, puis codes de secours affichés une seule fois.
- **Sessions en base** : jeton de 32 octets (empreinte SHA-256), cookie HttpOnly, SameSite=Strict, Secure et préfixe `__Host-` en production. Identifiant **renouvelé** après le mot de passe puis après la 2FA. 30 min d'inactivité, 12 h au plus. Changer de mot de passe ferme les autres sessions.
- **Verrouillage progressif** : 5 échecs, puis 1, 5, 15 et 60 min (mots de passe et codes comptés ensemble). Réponse identique pour compte inconnu, mauvais mot de passe et compte verrouillé. Limitation de débit (`ADMIN_LOGIN_RATE_LIMIT`).
- **Rôles** : `owner` et `staff`, déclarés **route par route** ; une route sans rôle est refusée. Équipe : tableau de bord (sans chiffre d'affaires), agenda, clientes (lecture et notes), galerie, avis. Propriétaire en plus : prestations et tarifs, contenus, réglages, journaux, export CSV, suppression RGPD, suppression de photo.
- **Premier compte** : `npm run admin:create` (questions à l'écran, mot de passe masqué ; `-- --role staff` pour l'équipe).
- **Journal d'audit** en ajout seul (déclencheur SQL), sans mot de passe ni code (filtre testé).

### Écrans

- **Aujourd'hui** : rendez-vous du jour, de la semaine, « à valider », avis à modérer, taux d'absence, CA estimé du mois (propriétaire).
- **Agenda** : jour, semaine, liste. Frise horaire avec zones fermées, tampons, ligne « maintenant ». **Glisser-déposer à la souris** (pas de 15 min, confirmation, case « prévenir la cliente », message d'erreur si le créneau est pris). Au doigt : fiche du RDV → « Choisir un autre créneau » (créneaux libres, sans délai minimum ni horizon). RDV **saisi par le salon** (hors horaires possible, jamais de chevauchement), statuts (terminé → demande d'avis, annulé → message), notes internes, photo des cheveux (derrière l'authentification), blocages.
- **Clientes** : recherche (nom, email, téléphone), fiche (historique, notes), **export CSV** (Excel français, sans injection de formules, accès journalisé), **suppression RGPD** par anonymisation (confirmation en deux temps).
- **Prestations et tarifs** : catégories, prestations (prix, durées, tampon, devis, visibilité, description en sections), options, méthodes ; **ordre par glisser-déposer** et boutons ↑ ↓ ; badge « à confirmer » tant que prix et durées ne sont pas validés.
- **Galerie** : envoi **multiple** (glisser-déposer ou choix), **recadrage** (portrait, carré, paysage, zoom), étiquettes (prestation, méthode, taille), **texte alternatif obligatoire** avec suggestion, ordre, mise en avant ; ré-encodage serveur (1600 et 600 px, EXIF supprimé). Les photos s'affichent sur la page Galerie et l'accueil (`/media/galerie/<uuid>.webp`).
- **Avis** : publier, refuser, réponse publique, mise en avant ; jamais de publication sans consentement.
- **Contenus** : bandeau d'annonce, chiffres et fondatrice, FAQ, articles du journal, étapes de la vie d'une loc.
- **Réglages** : réservation (délais, annulation, validation manuelle, politique), horaires, congés et fermetures (avertissement si des RDV existent), coordonnées et réseaux (appliquées au site). Réglages techniques en lecture seule.
- **Message « rendez-vous validé »** : valider une demande « à valider » envoie un email (avec fichier agenda et lien « Gérer mon RDV » renouvelé) et un SMS, modèle `booking_validated` visible dans le journal. Case « prévenir la cliente » cochée d'office ; rien ne part si on rouvre un RDV annulé. Les rappels déjà planifiés à la demande partent normalement.
- **Messages envoyés** (journal des notifications, destinataires masqués, filtre par état) et **Journal d'activité** (filtre par rubrique).

### Tests

- **Contrôle d'accès** (`admin/access.test.js`) : la liste des routes est **lue dans l'application** ; non connecté → 401 sur chacune, session sans 2FA → 401, session expirée / trop vieille / compte désactivé → 401, équipe sur route propriétaire → 403, équipe et propriétaire sur leurs routes → ni 401 ni 403 ni 500, écriture sans jeton CSRF → 403, une route sans rôle fait échouer le test.
- **Unitaires et intégration** : **UNIT** tests dans **FILES** fichiers (auth, TOTP, verrouillage, sessions, rotation, codes de secours, agenda sur base réelle, parcours HTTP, fonctions pures, CSV, RGPD, galerie, réglages, contenus, journaux, script de création de compte).
- **e2e** (`tests/e2e/admin.spec.js`, mobile et desktop) : connexion avec 2FA et première connexion (QR, codes de secours), RDV manuel, déplacement par créneaux libres et par glisser-déposer, annulation d'un glisser, blocage, clientes (recherche, CSV, suppression RGPD), modération d'un avis, prestation (création, prix, masquage), envoi d'une photo recadrée, droits de l'équipe, **axe-core WCAG A/AA sur 20 pages**, aucun défilement horizontal, zones tactiles ≥ 44 px, aucune erreur de console (donc aucune violation de la CSP).
- Revue visuelle (design-craft §10) à 390 et 1440 px : captures `docs/screenshots/admin-*-top.png` (`ADMIN_SHOTS=1 npx playwright test tests/e2e/admin-shots.spec.js`).
- Réservation en ligne : un interblocage PostgreSQL (`40P01`) lors de trois réservations simultanées du même créneau est maintenant traité comme « créneau pris » (le test pouvait échouer de façon aléatoire).
- Défauts trouvés par les tests et corrigés : horizon de réservation appliqué au déplacement par le salon ; barre de dates et filtres qui débordaient à 390 px ; boutons dont l'étiquette visible n'était pas dans le nom accessible ; prestation sans praticienne associée impossible à réserver par le salon ; erreurs affichées en JSON brut sur les formulaires classiques ; recherche par téléphone en format national.

## Phase 7 : fait

- **Audit sécurité indépendant** (sous-agent, lecture seule) : aucune faille critique, 1 haute, 5 moyennes, 10 basses. Corrigés : écrasement de fiche par la réservation publique (H1), jetons et IP dans les logs (M1), gestionnaire d'erreur 500 (M2), `trustProxy` (M5), configuration de production exigeante (M6), plafond de RDV par email (M4, partiel), `Permissions-Policy`, jeton CSRF d'URL masqué des logs (B1). **Assumés et documentés** dans `SECURITY.md` : verrouillage du compte propriétaire par un tiers (M3), preuve de travail légère, audit_log sans protection DELETE, droits de l'équipe.
- **`npm audit`** : 0 vulnérabilité. CI GitHub (audit, lint, types, contrastes, tests sur PostgreSQL) et Dependabot ajoutés.
- **RGPD** : pages légales complétées (photo de cheveux, lettre, durées exactes, cookies strictement nécessaires) ; **export JSON des données d'une cliente** (droit d'accès, propriétaire, tracé) ; **purge quotidienne** (`modules/retention`) : clientes inactives anonymisées après 3 ans (réglage `privacy.client_retention_years`), photos de cheveux à 1 an, destinataires et IP à 12 mois, sessions expirées. Consentements séparés : SMS de rappel (transactionnel), lettre (opt-in non coché), politique de RDV (obligatoire). Les informations légales restent `TODO-PROPRIO` (SIRET, hébergeur, adresse).
- **SEO** : déjà en place depuis la phase 2 et vérifié (title et meta uniques, Open Graph avec visuel de marque, canonical, `sitemap.xml`, `robots.txt`, JSON-LD `HairSalon`, `Service`, `FAQPage`).
- **Accessibilité et performance** (Lighthouse, mobile, serveur en mode production, 6 pages : accueil, prestations, méthodes, réserver, contact, confidentialité) : **accessibilité 100, bonnes pratiques 100, SEO 100 partout**, CLS 0 à 0,001, JS initial de l'accueil **≈ 4 ko gzip** (GSAP chargé à la demande), transfert de l'accueil 283 ko. axe-core WCAG A/AA déjà couvert par les e2e (20 pages admin).
- **Performance : à re-mesurer.** Scores mesurés ici : 98 (confidentialité), 89 (prestations), 77 (réserver) ; accueil, contact et méthodes autour de 60 (avant correctif : 33 à 65). Le temps de blocage (TBT) y est dominé par « Style & Layout », « Autre » et le ramasse-miettes, alors que le script ne pèse que 300 ms : la machine de test (4 Go de RAM, disque plein, benchmark Lighthouse 600) fausse la mesure. **Budget §16 (≥ 90) non confirmé** : refaire `lighthouse` sur une machine saine ou en ligne.
- **Correctif de performance** : le grain papier n'utilise plus `mix-blend-mode` (recomposition d'un calque plein écran par section) ; accueil 33 → 60 et prestations 65 → 89 sur cette machine. Rendu quasi identique (grain très léger).

## Reste à faire (phase 8 et suivantes)

- **Performance** : mesurer Lighthouse sur une machine saine ; si l'accueil reste sous 90, auditer le coût de Style & Layout (animations de révélation, SVG décoratifs, polices) ; vidéo du hero < 2 Mo quand elle existera.
- **Durée de conservation** : pas d'écran d'admin pour `privacy.client_retention_years` (3 ans par défaut).
- **Sécurité** : verrouillage du compte propriétaire (verrou par compte et IP, script `admin:unlock`), plafond par téléphone, preuve de travail renforcée, DELETE / TRUNCATE sur `audit_log`.

- **Notifications en production** : créer le compte Brevo, valider l'expéditeur (SPF, DKIM), renseigner `NOTIFICATIONS_PROVIDER=brevo`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `OWNER_EMAIL`, `GOOGLE_REVIEW_URL`, puis envoyer un message réel. Le fournisseur Brevo n'a été testé qu'avec un faux `fetch`. Tester aussi les emails dans Gmail, Outlook et Apple Mail (§7.6).
- **Phase 6 : suites** :
  - **Textes des emails et SMS éditables** (`messages.js`) : lecture seule pour l'instant ; l'édition doit garder les garde-fous (160 caractères GSM, lien jamais tronqué).
  - **Textes de l'accueil et de « Le salon »** : toujours dans les gabarits (le bandeau, les chiffres, la FAQ, les articles et les étapes sont éditables). Les passer en blocs de contenu est une évolution.
  - **Réglages d'infrastructure** (`BOOKING_PROVIDER`, lien Fresha, lien avis Google, fournisseur d'envoi) : restent dans l'environnement du serveur.
  - **Horaires par praticienne** : l'écran applique la même grille à toutes les praticiennes actives (une seule aujourd'hui).
  - **Gestion des comptes** (créer une employée, désactiver, réinitialiser la 2FA) : aujourd'hui par script (`npm run admin:create`) et en base.
- Formulaire de contact réel (CSRF, rate limiting, honeypot, Zod, envoi Brevo) : le bouton est désactivé avec une explication en attendant.
- Script d'import des photos (§12 : AVIF/WebP, `srcset`, EXIF supprimé), puis remplacer les placeholders.
- Textes d'interface dans des fichiers de traduction (i18n, §18) : non fait en phase 2, les contenus métier sont déjà séparés des templates (seeds JSON).
- CI (lint, tests, `npm audit`) à mettre en place.

## Décisions prises

- **Phase 4, prestations longues** : un RDV de 4 h ou plus (`booking.long_service_minutes`, durée bloquée tampon compris) peut traverser la pause de midi. Il commence dans une plage et finit au plus tard à la dernière fermeture du jour. Sinon, aucune création de locks (6h15 bloquées) ne tiendrait dans les plages actuelles (3 h et 4 h). À faire valider par la propriétaire.
- **Phase 4, durées réelles** : les créneaux avancent en temps UTC depuis l'ouverture. Un RDV de 3 h dure 3 h, même la nuit du changement d'heure.
- **Phase 4, grille** : créneaux toutes les 30 min depuis l'ouverture de chaque plage (`booking.slot_step_minutes`).
- **Phase 4, praticienne** : pas de choix dans le tunnel. La première praticienne libre est attribuée (et conservée au déplacement si elle est libre). Les identifiants ne sortent jamais de l'API.
- **Phase 4, fiche cliente** : clé = email. Une nouvelle réservation met à jour nom, téléphone et choix SMS ; la newsletter n'est jamais décochée par une réservation (opt-in daté).
- **Phase 4, anti-robot** : preuve de travail maison sur le principe d'ALTCHA plutôt que le widget ALTCHA, qui injecte des styles incompatibles avec la CSP. Turnstile a été écarté (tiers, cookies). Difficulté : 20 000 essais, calculés par lots pendant l'étape 3.
- **Phase 4, `.ics`** : la fin affichée exclut le tampon de rangement ; le flux de la propriétaire montre l'occupation complète. Le lien Google Agenda ne contient jamais le jeton.
- **Phase 4, données communes** (correctif des phases 2-3) : le hook `onRequest` relançait 7 requêtes SQL **à chaque requête** dès que le cache expirait (y compris pour chaque module servi par Vite). Sous charge, le pool saturait. Il y a maintenant un seul rechargement à la fois, en arrière-plan, et les requêtes servent le cache en attendant.
- **Phase 4, outillage de dev** : GSAP et Lenis sont pré-optimisés par Vite (`optimizeDeps.include`). Avant, leur découverte tardive rechargeait toutes les pages ouvertes. Le pool PostgreSQL active le keep-alive TCP.
- **Phase 4, `/rdv/:token`** : pages serveur avec formulaires classiques, utilisables sans JS. Seul le tunnel exige JavaScript (message `<noscript>` avec lien vers le contact).

- **Phase 3, modules** : noms du §11 (`services`, `content`). Le SQL ne vit que dans les `repo.js` ; migrations et seeds sont les seules autres sources de SQL.
- **Phase 3, statuts en anglais** en base (`pending`, `confirmed`, `completed`, `cancelled_by_client`, `cancelled_by_salon`, `no_show`), libellés français à l'affichage.
- **Phase 3, prix en centimes** en base, en euros dans le code (conversion dans les repos).
- **Phase 3, `appointments.ends_at`** inclut le tampon : c'est la fin d'occupation du planning.
- **Phase 3, tests sur base dédiée** : `npm test` exige PostgreSQL (`npm run db:up`).

- **Eta appelé directement** (`src/server/lib/view.js`), sans `@fastify/view` : moins de magie, même échappement automatique.
- **PostgreSQL 17** (le cahier des charges demande 16 ou plus).
- **Lien et petit texte accent = terre cuite assombrie** (`--color-terre-600`, oklch 46,5 %) sur fond clair : 6,3:1 sur karité et 5,2:1 sur lin, alors que la terre d'origine fait 4,2:1 sur lin. La terre BRAND.md reste la couleur des boutons, des fonds et du mot italique des grands titres. En sombre, l'accent texte est éclairci (`--color-terre-400`).
- **Couleurs d'état accordées à la palette** : succès « feuille », erreur « bordeaux » (distinct de la terre), alerte « ocre ».
- **Styleguide** : actif hors production, 404 en production (forçable avec `STYLEGUIDE_ENABLED`), `noindex`.
- **CSP en dev** : on autorise en plus `ws:` pour le HMR de Vite. Aucun `unsafe-inline`, ni en dev ni en prod.
- **Logos** : les fichiers `brand/emblème*.svg` ont des noms abîmés à la décompression (`embl├¿me…`). Ils sont copiés sans accent dans `public/brand/` (`embleme.svg`…) ; `brand/` n'est pas modifié.
- **Sections** : `overflow-x: clip` sur `.section`, pour que les décors (soleil, fil) puissent déborder sans créer de défilement horizontal.
- **Captures** : seules les vues « au-dessus de la ligne de flottaison » sont commitées ; les pleines pages se régénèrent avec `npm run screenshots`.
- **Phase 2, données** : seeds JSON lus par les `repo.js` (async, comme le futur `pg`), données communes (méga-menu, réglages) chargées une fois au démarrage.
- **Phase 2, textes riches** : convention `*mot*` → `<em>` (mot italique terre cuite), via `fmt.accent()` qui échappe le texte **avant** la conversion.
- **Phase 2, JSON-LD** : sérialisé côté serveur avec `<` neutralisé, injecté dans un `<script type="application/ld+json">` avec nonce.
- **Phase 2, plan** : pas d'iframe de carte (CSP, traceurs) ; plan stylisé décoratif + lien OpenStreetMap.
- **Phase 2, entrées Vite** : `home`, `services` (prestations, détail, tarifs), `methods`, `gallery`, `editorial` (autres pages), `styleguide`.
- **Phase 2, prix** : affichés tels quels côté public (`isPlaceholder` sert au badge « à confirmer » en admin, §6).
- Le tout premier commit (outillage) a été fait avec `--no-verify`, avant que lint-staged n'ait de fichiers à traiter. Tous les commits suivants passent par le hook.

## Décisions de la phase 5

- **Rappels** : email J-2 à 10h, SMS J-1 à 18h (heure de Paris), non envoyés s'ils sont déjà passés à la réservation. Les RDV `pending` n'en reçoivent pas.
- **Annuler ou déplacer** : pas d'annulation de jobs, mais des garde-fous à l'exécution (un job égaré ne produit jamais un message erroné).
- **Alerte propriétaire** : aussi envoyée pour un déplacement ou une annulation (le §7.6 ne cite que le nouveau RDV).
- **Relance d'avis** : un nouveau lien est émis, avec l'**échéance du premier** (pas de prolongation) ; une seule relance par RDV.
- **Journal** : une ligne par message et par canal, destinataire inclus (purge à 12 mois, cf. DATABASE.md). La console n'affiche que des destinataires masqués.
- **Limite connue** : la planification se fait après l'enregistrement du RDV, pas dans la même transaction. Si la base de jobs était indisponible à cet instant, les messages ne partiraient pas (l'erreur est journalisée).
- **Un avis vérifié bloque la suppression de son RDV** (contrainte `reviews_verified_needs_appointment`) : la suppression passera par l'anonymisation de la cliente.

## Décisions de la phase 6

- **Rendu serveur + formulaires classiques**, JavaScript en amélioration : tout marche sans glisser-déposer (flèches ↑ ↓, créneaux libres). Pas de SPA.
- **Sessions en base**, pas de JWT ; **TOTP écrit sur node:crypto** (testé avec les vecteurs de la RFC) ; `@node-rs/argon2` (binaires précompilés) et `qrcode` sont les deux dépendances ajoutées.
- **Refus par défaut** : une route /admin sans rôle déclaré est interdite, et un test le prouve.
- **Suppression RGPD = anonymisation** : l'historique (dates, prestations, montants) reste sans lien avec une personne ; les RDV à venir sont annulés **sans message** (la cliente n'existe plus).
- **Cliente sans email** (RDV par téléphone) : email de remplacement sur `sans-email.invalid` (RFC 2606), ignoré par les notifications (les SMS partent), jamais affiché ni exporté.
- **Déplacement par l'admin** : le lien « Gérer mon RDV » est renouvelé (la base ne garde que l'empreinte) et le nouveau lien part dans l'email.
- **Le salon n'est pas soumis aux règles de la réservation en ligne** : pas de délai minimum, pas d'horizon, hors horaires possible. Il reste soumis au planning : jamais de chevauchement (contrainte PostgreSQL) ni sur un blocage.
- **Horaires** : un enregistrement vide est refusé (il fermerait tout) ; les congés n'annulent jamais de RDV automatiquement.
- **Statuts** : transitions autorisées en tableau (`TRANSITIONS`), « terminé » et « absence » seulement après le début du RDV ; un RDV annulé peut être rouvert si le créneau est libre.
- **Photos de galerie** : une requête par photo (recadrées dans le navigateur), orientation déduite des dimensions réelles, noms UUID, diffusion publique limitée à ce motif.
- **e2e** : sessions pré-créées en base (`tests/e2e/.auth/`, ignoré par git) pour ne pas rejouer mot de passe et code à chaque test ; la connexion par formulaire a ses propres tests.

## Points d'attention

- **Avis d'exemple en base** : ils sont publiés (`approved`) comme en phase 2. Avant la mise en ligne, les supprimer (`is_placeholder`) : tant qu'il n'y a pas de vrai avis, le §8 demande de masquer les blocs.
- **Horaires** : mardi-vendredi 9h-12h puis 14h-18h, samedi 14h-18h, fermé lundi et dimanche (donnés par la propriétaire). Modifiables et blocables depuis l'admin (phase 6, tables `opening_hours`, `closures`, `blocks`), jamais écrasés par le seed.
- Les e2e et `npm run dev` utilisent la base de dev : lancer `npm run db:up && npm run db:migrate && npm run db:seed` d'abord.

- **e2e sur cette machine (4 Go de RAM)** : Playwright tourne avec **un seul worker** en local (`E2E_WORKERS` pour en mettre plus). Avec plusieurs Chromium, Vite et PostgreSQL (Docker) en parallèle, la mémoire libre tombait à ~50 Mo : requêtes de l'API sans réponse pendant une minute, puis workers qui plantent (`0xC0000142`). Si besoin, lancer les specs séparément (`npx playwright test tests/e2e/booking.spec.js --project=desktop`). Dernier passage : 66 verts, 4 ignorés (desktop uniquement).
- **Premier compte propriétaire** : `npm run admin:create`, puis ouvrir `/admin` et configurer l'application d'authentification (**noter les codes de secours**). Sans eux, perdre le téléphone oblige à réinitialiser la 2FA en base.
- Les e2e de l'admin créent des comptes et des données dans la **base de développement** (domaine `@admin-e2e.test.invalid`, préfixe « E2E »), supprimés avant et après la suite.
- Le projet est dans **OneDrive** : `node_modules` et `dist/` sont synchronisés en continu, ce qui ralentit et peut verrouiller des fichiers. Il est conseillé de déplacer le dépôt hors de OneDrive, ou d'exclure ces dossiers de la synchronisation. La base, elle, est dans un volume Docker.
- Le serveur de dev de Vite affiche le port HMR `PORT + 21000` (24000 pour le port 3000).

## Questions pour la propriétaire

0. **Phase 6** : l'équipe (employées) doit-elle voir les montants des rendez-vous ? Qui crée les comptes ? Les droits proposés (équipe : agenda, clientes, galerie, avis ; propriétaire : tout le reste) conviennent-ils ? Faut-il un message « votre rendez-vous est validé » quand vous validez une demande ? Souhaitez-vous modifier vous-même les textes des emails et SMS ?

1. **Phase 5** : adresse email qui reçoit les alertes de RDV ? Lien de votre fiche Google pour les avis ? Textes des emails et SMS à relire (`modules/notifications/messages.js`) ? Heures de rappel (J-2 à 10h, veille à 18h) ?

2. Prénom et nom de la fondatrice, adresse exacte, horaires, téléphone, WhatsApp, Instagram (marqués `TODO-PROPRIO` dans `src/server/lib/site.js`).
3. Prix et durées réels de chaque prestation et option (les valeurs du styleguide sont des exemples).
4. Validez-vous la direction visuelle du styleguide (captures dans `docs/screenshots/`), en particulier le fil de loc et la trame bogolan ?
5. Pouvez-vous fournir des fichiers d'emblème aux noms intacts (les accents ont été perdus à la décompression) ?
6. Validation manuelle des RDV ou confirmation automatique (automatique pour l'instant, réglage `booking.manual_validation`) ? Délai d'annulation (48 h par défaut) ? Texte de la politique de RDV (`booking.policy_text`) ?
7. **Prestations longues** : travaillez-vous pendant la pause de midi pour une création (6 à 8 h) ? Le site l'autorise à partir de 4 h. Faut-il un délai minimum plus long (24 h aujourd'hui) ou des créneaux seulement le matin pour ces prestations ?
8. Conseils de préparation affichés à la confirmation (`PREPARATION_TIPS` dans `booking/service.js`) : à relire.
9. Composition exacte de la détox ; certification Sisterlocks™ ; formations proposées ?
10. Photos originales (réalisations, portrait, salon), idéalement une vidéo de 10 s pour le hero, à déposer dans `content/photos-a-importer/`.
11. Nom de domaine souhaité, compte Brevo, hébergement.
12. **Avis** : les 8 avis du site sont des **exemples** (`reviews.json`). Pouvez-vous fournir de vrais avis (Google, messages de clientes, avec leur accord) ? Ils doivent remplacer les exemples avant la mise en ligne.
13. Relire les textes : histoire Dakar → Toulouse, guide des méthodes, articles, FAQ, pages légales (SIRET, hébergeur), composition du bain détox.
14. Nombre de clientes accompagnées et années d'expérience (bandeau de l'accueil : « 400 » et « 8 ans » sont provisoires).
15. Compte Instagram et sélection de 6 à 9 photos pour la grille de l'accueil.
