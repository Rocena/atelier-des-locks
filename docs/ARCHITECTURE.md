# Architecture

> Vue d'ensemble des modules et des flux de données. À tenir à jour à chaque phase.

## Vue d'ensemble

```
Navigateur ──HTTP──▶ Fastify (src/server/app.js)
                      ├─ @fastify/helmet : en-têtes + CSP à nonces (un nonce par requête)
                      ├─ dev  : middleware Vite (HMR, sources servies telles quelles)
                      │  prod : @fastify/static sur dist/client (assets hashés, cache 1 an)
                      ├─ reply.page(template, entrée, données)
                      │    ├─ Eta rend src/views/pages/<template>.eta dans layouts/base.eta
                      │    └─ lib/assets.js injecte CSS/JS de l'entrée (sources en dev, manifest en prod)
                      └─ modules/<domaine>/routes.js ──▶ service.js (métier pur) ──▶ repo.js (SQL) ──▶ PostgreSQL
```

## Dossiers

| Dossier                 | Rôle                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/server/config.js`  | Seul point de lecture de l'environnement, validé par Zod                                                                  |
| `src/server/app.js`     | Création de l'app, plugins de sécurité, rendu, enregistrement des modules                                                 |
| `src/server/lib/`       | Utilitaires partagés : `assets.js` (Vite), `view.js` (Eta), `site.js` (infos du salon)                                    |
| `src/server/modules/`   | Un dossier par domaine : `site`, `services`, `gallery`, `reviews`, `content`, `styleguide` (à venir : `booking`, `admin`) |
| `src/server/db/`        | `pool.js`, `migrate.js`, `seed.js`, `seed-content.js`, `migrations/*.sql`, `seeds/*` (SQL et JSON de départ)              |
| `src/views/`            | Templates Eta : `layouts/`, `partials/` (composants), `pages/`                                                            |
| `src/client/entries.js` | Liste des entrées Vite (une page = un CSS + un JS)                                                                        |
| `src/client/styles/`    | `tokens.css`, `base.css`, `layout.css`, `components/*.css`, `pages/*.css`                                                 |
| `src/client/scripts/`   | `common.js` + `components/*.js` + `pages/*.js`                                                                            |
| `public/`               | Fichiers servis tels quels (logos en noms ASCII, favicon)                                                                 |
| `tests/e2e/`            | Playwright (desktop 1440, mobile 390)                                                                                     |

## Front-end

- **Couches CSS** (`main.css`) : `reset, tokens, base, layout, components, utilities, pages`.
- **Tokens** : primitives OKLCH (palette BRAND.md) → tokens sémantiques (`--surface`, `--text`, `--accent-text`…) redéfinis pour `[data-theme='dark']` et `[data-surface='ebene']`. Les composants n'utilisent que les tokens sémantiques.
- **Thème** : script inline (avec nonce) qui pose `data-theme` avant le rendu ; sans JS, `prefers-color-scheme`.
- **JS** : modules ES. `common.js` (thème, header, menus, barre Réserver, révélations, curseur, bandeau défilant) sur toutes les pages, ~4 ko gzip.
- **Mouvement** : `scripts/motion/smooth.js` (Lenis) et `scripts/motion/gsap.js` (GSAP, ScrollTrigger, SplitText) sont importés dynamiquement à la **première interaction**, jamais en mouvement réduit (`withMotion()` dans `common.js`). Le hero, le loader et les View Transitions sont en CSS pur.
- **Polices** : Fontsource (Bodoni Moda opsz + italique, Manrope), auto-hébergées, préchargées en production.

## Données

- Tout le contenu public vient de PostgreSQL (schéma : `docs/DATABASE.md`). Les `repo.js` reçoivent le pool (`app.db`) et renvoient des objets simples ; routes et templates ne connaissent pas le SQL.
- Les JSON de `db/seeds/` ne servent plus qu'à alimenter la base (`npm run db:seed`).
- Les données communes (méga-menu, bandeau) sont relues en base au plus toutes les 30 s.
- Lecture publique en JSON : `/api/services`, `/api/gallery`, `/api/reviews`, `/api/articles`, `/api/content/:key`.
- Convention de contenu : `*mot*` devient le mot en italique terre cuite (`fmt.accent()`, échappement préalable).
- `reply.page()` injecte dans chaque page : `site`, `settings` (bandeau), `navigation` (méga-menu), `fmt`, `canonical`, `jsonLd` (sérialisé et neutralisé).

## Base de données

- PostgreSQL 17 (Docker en local), dates en `timestamptz` stockées en UTC (`options: -c timezone=UTC`).
- Migrations SQL versionnées avec somme de contrôle : une migration appliquée ne peut plus être modifiée.
- Tables actuelles : `schema_migrations`, `settings`. Le schéma complet arrive en phase 3 (`docs/DATABASE.md`).

## Réservation

Adaptateur `BOOKING_PROVIDER` (`internal` | `fresha_link`), cf. [ADR 0001](decisions/0001-booking-internal-vs-fresha.md).
