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

| Dossier                 | Rôle                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `src/server/config.js`  | Seul point de lecture de l'environnement, validé par Zod                                    |
| `src/server/app.js`     | Création de l'app, plugins de sécurité, rendu, enregistrement des modules                   |
| `src/server/lib/`       | Utilitaires partagés : `assets.js` (Vite), `view.js` (Eta), `site.js` (infos du salon)      |
| `src/server/modules/`   | Un dossier par domaine (`site`, `styleguide` ; à venir : `services`, `booking`, `reviews`…) |
| `src/server/db/`        | `pool.js`, `migrate.js`, `seed.js`, `migrations/*.sql`, `seeds/*.sql`                       |
| `src/views/`            | Templates Eta : `layouts/`, `partials/` (composants), `pages/`                              |
| `src/client/entries.js` | Liste des entrées Vite (une page = un CSS + un JS)                                          |
| `src/client/styles/`    | `tokens.css`, `base.css`, `layout.css`, `components/*.css`, `pages/*.css`                   |
| `src/client/scripts/`   | `common.js` + `components/*.js` + `pages/*.js`                                              |
| `public/`               | Fichiers servis tels quels (logos en noms ASCII, favicon)                                   |
| `tests/e2e/`            | Playwright (desktop 1440, mobile 390)                                                       |

## Front-end

- **Couches CSS** (`main.css`) : `reset, tokens, base, layout, components, utilities, pages`.
- **Tokens** : primitives OKLCH (palette BRAND.md) → tokens sémantiques (`--surface`, `--text`, `--accent-text`…) redéfinis pour `[data-theme='dark']` et `[data-surface='ebene']`. Les composants n'utilisent que les tokens sémantiques.
- **Thème** : script inline (avec nonce) qui pose `data-theme` avant le rendu ; sans JS, `prefers-color-scheme`.
- **JS** : modules ES sans dépendance. GSAP, ScrollTrigger et Lenis arrivent en phase 2, chargés à la demande.
- **Polices** : Fontsource (Bodoni Moda opsz + italique, Manrope), auto-hébergées, préchargées en production.

## Base de données

- PostgreSQL 17 (Docker en local), dates en `timestamptz` stockées en UTC (`options: -c timezone=UTC`).
- Migrations SQL versionnées avec somme de contrôle : une migration appliquée ne peut plus être modifiée.
- Tables actuelles : `schema_migrations`, `settings`. Le schéma complet arrive en phase 3 (`docs/DATABASE.md`).

## Réservation

Adaptateur `BOOKING_PROVIDER` (`internal` | `fresha_link`), cf. [ADR 0001](decisions/0001-booking-internal-vs-fresha.md).
