# L'Atelier des Locks : règles pour agents IA

Site + plateforme de réservation d'un salon de locks (cheveux afro, femmes) à Toulouse.
Direction : « éditorial afro-luxe ». Stack : Node LTS, Fastify, Eta (SSR), Vite multi-pages,
CSS moderne + JS vanilla (ES modules, JSDoc + `// @ts-check`), PostgreSQL (SQL à la main, `pg`).

## En début de session

1. **Lire `docs/PROGRESS.md`** (fait / reste / décisions). Le mettre à jour en fin de phase.
2. Ne lire du cahier des charges (`docs/CAHIER_DES_CHARGES.md`) que la section utile à la tâche.
3. Front-end : appliquer `.claude/skills/design-craft/SKILL.md` et `brand/BRAND.md` à la lettre.

## Commandes

- `npm run dev` : serveur + Vite (http://127.0.0.1:3000, `/styleguide` en dev)
- `npm test` · `npm run test:e2e` · `npm run lint` · `npm run typecheck` · `npm run check:contrast`
- `npm run db:up` · `npm run db:migrate` · `npm run db:seed` · `npm run build` · `npm run screenshots -- <url>` · `npm run og-image`

## Conventions (§11)

- Code en anglais, contenu et interface en français (**vouvoiement**), commentaires métier en français.
- 1 dossier = 1 domaine : `src/server/modules/<domaine>/` (routes.js, service.js, repo.js, schemas.js, README.md ≤ 10 lignes, \*.test.js).
- Métier en fonctions pures testables. **Le SQL ne vit que dans `repo.js`.** Pas de logique dans les routes.
- Migrations : `src/server/db/migrations/NNNN_nom.sql`, jamais modifiées une fois appliquées.
- Pages : template `src/views/pages/*.eta` + entrée Vite (CSS + JS) déclarée dans `src/client/entries.js`.
- CSS : couches `@layer`, valeurs uniquement via `src/client/styles/tokens.css`, un fichier par composant.
- Pas de lorem ipsum. Info à confirmer → `<!-- TODO-PROPRIO -->`. Aucune photo récupérée sur le web.
- Commits conventionnels (`feat:`, `fix:`, `docs:`…), un commit par étape logique.

## Sécurité (§13, non négociable)

- CSP stricte à nonces (`reply.cspNonce`) : aucun script/style inline sans nonce, aucun attribut `style=""`.
- Requêtes SQL **toujours paramétrées** (`$1`), jamais de concaténation.
- Toute entrée validée côté serveur avec Zod ; échappement Eta (`<%= %>`), `<%~ %>` réservé au contenu sûr.
- Admin : argon2id, 2FA TOTP obligatoire, sessions serveur, cookies HttpOnly/Secure/SameSite.
- CSRF sur tous les formulaires ; rate limiting + honeypot sur les formulaires publics.
- Jetons de liens (RDV, avis) : ≥ 32 octets aléatoires, stockés hashés, à durée limitée.
- Uploads : magic bytes, taille max, ré-encodage sharp, noms aléatoires, hors webroot.
- Contrôle d'accès par rôle sur chaque route admin, prouvé par des tests.
- Secrets via variables d'environnement uniquement (`src/server/config.js`), `.env` jamais commité.
- Logs sans données personnelles ; audit log des actions admin. Checklist : `docs/SECURITY.md`.

## Références

- Cahier des charges : `docs/CAHIER_DES_CHARGES.md` · Architecture : `docs/ARCHITECTURE.md`
- Décisions (ADR) : `docs/decisions/` · Identité : `brand/BRAND.md` · Design : `.claude/skills/design-craft/SKILL.md`
