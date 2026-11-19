# Journal d'avancement

> À lire en début de session, à mettre à jour en fin de phase.
> Phases : cf. §17 du cahier des charges.

## État actuel

| Phase               | Statut                                                                          | Critère de fin                                        |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 0 · Mise en place   | ✅ terminée (2026-11-19)                                                        | `npm run dev`, lint et tests passent                  |
| 1 · Design system   | ✅ terminée (2026-11-19), en attente de validation visuelle par la propriétaire | Styleguide validé (captures dans `docs/screenshots/`) |
| 2 · Pages publiques | ⏭️ prochaine                                                                    |                                                       |

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

## Reste à faire (phase 2 et suivantes)

- Phase 2 : toutes les pages du §5 avec contenus seed. GSAP + ScrollTrigger + SplitText + Lenis (chargés à la demande), View Transitions, méga-menu desktop, barre « Réserver » collante sur mobile, bandeau d'annonce, fil d'Ariane, loader d'entrée, boutons magnétiques et curseur sur desktop. Textes dans des fichiers de traduction (i18n, §18). Lighthouse.
- Image Open Graph de marque, `sitemap.xml`, `robots.txt`, JSON-LD `HairSalon`.
- `docs/DATABASE.md` à créer en phase 3 avec le schéma.
- CI (lint, tests, `npm audit`) à mettre en place.

## Décisions prises

- **Eta appelé directement** (`src/server/lib/view.js`), sans `@fastify/view` : moins de magie, même échappement automatique.
- **PostgreSQL 17** (le cahier des charges demande 16 ou plus).
- **Lien et petit texte accent = terre cuite assombrie** (`--color-terre-600`, oklch 46,5 %) sur fond clair : 6,3:1 sur karité et 5,2:1 sur lin, alors que la terre d'origine fait 4,2:1 sur lin. La terre BRAND.md reste la couleur des boutons, des fonds et du mot italique des grands titres. En sombre, l'accent texte est éclairci (`--color-terre-400`).
- **Couleurs d'état accordées à la palette** : succès « feuille », erreur « bordeaux » (distinct de la terre), alerte « ocre ».
- **Styleguide** : actif hors production, 404 en production (forçable avec `STYLEGUIDE_ENABLED`), `noindex`.
- **CSP en dev** : on autorise en plus `ws:` pour le HMR de Vite. Aucun `unsafe-inline`, ni en dev ni en prod.
- **Logos** : les fichiers `brand/emblème*.svg` ont des noms abîmés à la décompression (`embl├¿me…`). Ils sont copiés sans accent dans `public/brand/` (`embleme.svg`…) ; `brand/` n'est pas modifié.
- **Sections** : `overflow-x: clip` sur `.section`, pour que les décors (soleil, fil) puissent déborder sans créer de défilement horizontal.
- **Captures** : seules les vues « au-dessus de la ligne de flottaison » sont commitées ; les pleines pages se régénèrent avec `npm run screenshots`.
- Le tout premier commit (outillage) a été fait avec `--no-verify`, avant que lint-staged n'ait de fichiers à traiter. Tous les commits suivants passent par le hook.

## Points d'attention

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
