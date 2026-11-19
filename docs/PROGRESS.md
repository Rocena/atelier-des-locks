# Journal d'avancement

> À lire en début de session, à mettre à jour en fin de phase.
> Phases : cf. §17 du cahier des charges.

## État actuel

| Phase               | Statut                                                                          | Critère de fin                                        |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 0 · Mise en place   | ✅ terminée (2026-11-19)                                                        | `npm run dev`, lint et tests passent                  |
| 1 · Design system   | ✅ terminée (2026-11-19), en attente de validation visuelle par la propriétaire | Styleguide validé (captures dans `docs/screenshots/`) |
| 2 · Pages publiques | ✅ terminée (2026-11-19), contenus seed à valider par la propriétaire           | Pages du §5, budgets §16 (Lighthouse mobile)          |
| 3 · Base de données | ✅ terminée (2026-11-19)                                                        | Seeds JSON migrés en tables, `docs/DATABASE.md`       |
| 4 · Réservation     | ⏭️ prochaine                                                                    | Tests du moteur, e2e réservation                      |

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

## Reste à faire (phase 4 et suivantes)

- Formulaire de contact réel (CSRF, rate limiting, honeypot, Zod, envoi Brevo) : le bouton est désactivé avec une explication en attendant.
- Tunnel de réservation (§7), pages à jeton `/rdv/:token` et `/avis/laisser/:token`.
- Script d'import des photos (§12 : AVIF/WebP, `srcset`, EXIF supprimé), puis remplacer les placeholders.
- Textes d'interface dans des fichiers de traduction (i18n, §18) : non fait en phase 2, les contenus métier sont déjà séparés des templates (seeds JSON).
- CI (lint, tests, `npm audit`) à mettre en place.

## Décisions prises

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

## Points d'attention

- **Avis d'exemple en base** : ils sont publiés (`approved`) comme en phase 2. Avant la mise en ligne, les supprimer (`is_placeholder`) : tant qu'il n'y a pas de vrai avis, le §8 demande de masquer les blocs.
- **Aucun horaire d'ouverture** n'est semé (inconnus) : le moteur de la phase 4 ne proposera aucun créneau tant qu'ils ne sont pas saisis.
- Les e2e et `npm run dev` utilisent la base de dev : lancer `npm run db:up && npm run db:migrate && npm run db:seed` d'abord.

- Le projet est dans **OneDrive** : `node_modules` et `dist/` sont synchronisés en continu, ce qui ralentit et peut verrouiller des fichiers. Il est conseillé de déplacer le dépôt hors de OneDrive, ou d'exclure ces dossiers de la synchronisation. La base, elle, est dans un volume Docker.
- Le serveur de dev de Vite affiche le port HMR `PORT + 21000` (24000 pour le port 3000).

## Questions pour la propriétaire

1. Prénom et nom de la fondatrice, adresse exacte, horaires, téléphone, WhatsApp, Instagram (marqués `TODO-PROPRIO` dans `src/server/lib/site.js`).
2. Prix et durées réels de chaque prestation et option (les valeurs du styleguide sont des exemples).
3. Validez-vous la direction visuelle du styleguide (captures dans `docs/screenshots/`), en particulier le fil de loc et la trame bogolan ?
4. Pouvez-vous fournir des fichiers d'emblème aux noms intacts (les accents ont été perdus à la décompression) ?
5. Validation manuelle des RDV ou confirmation automatique ? Délai d'annulation (48 h par défaut) ?
6. Composition exacte de la détox ; certification Sisterlocks™ ; formations proposées ?
7. Photos originales (réalisations, portrait, salon), idéalement une vidéo de 10 s pour le hero, à déposer dans `content/photos-a-importer/`.
8. Nom de domaine souhaité, compte Brevo, hébergement.
9. **Avis** : les 8 avis du site sont des **exemples** (`reviews.json`). Pouvez-vous fournir de vrais avis (Google, messages de clientes, avec leur accord) ? Ils doivent remplacer les exemples avant la mise en ligne.
10. Relire les textes : histoire Dakar → Toulouse, guide des méthodes, articles, FAQ, pages légales (SIRET, hébergeur), composition du bain détox.
11. Nombre de clientes accompagnées et années d'expérience (bandeau de l'accueil : « 400 » et « 8 ans » sont provisoires).
12. Compte Instagram et sélection de 6 à 9 photos pour la grille de l'accueil.
