# L'Atelier des Locks

Site et plateforme de réservation du salon **L'Atelier des Locks**, locticienne à Toulouse.

## Démarrer en 5 minutes

Prérequis : Node.js LTS (22 ou plus) et Docker Desktop.

```bash
npm install
cp .env.example .env          # puis remplacer SESSION_SECRET
npm run db:up                 # PostgreSQL dans Docker
npm run db:migrate
npm run db:seed
npm run dev                   # http://127.0.0.1:3000
```

Le design system est visible sur http://127.0.0.1:3000/styleguide (hors production).

## Commandes utiles

| Commande                                             | Rôle                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `npm test`                                           | Tests unitaires et d'intégration (Vitest)                       |
| `npm run test:e2e`                                   | Tests de bout en bout (Playwright, desktop et mobile)           |
| `npm run lint` / `npm run format`                    | ESLint + Prettier                                               |
| `npm run typecheck`                                  | Vérification des types JSDoc (`checkJs`)                        |
| `npm run check:contrast`                             | Contrastes WCAG AA des tokens, en clair et en sombre            |
| `npm run build` puis `NODE_ENV=production npm start` | Build Vite et serveur de production                             |
| `npm run screenshots`                                | Captures du styleguide (serveur lancé) dans `docs/screenshots/` |

Première installation de Playwright : `npx playwright install chromium`.

## Documentation

- [CLAUDE.md](CLAUDE.md) : règles du projet (humains et agents IA)
- [docs/CAHIER_DES_CHARGES.md](docs/CAHIER_DES_CHARGES.md) : la référence fonctionnelle
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/SECURITY.md](docs/SECURITY.md) · [docs/PROGRESS.md](docs/PROGRESS.md)
- [brand/BRAND.md](brand/BRAND.md) : identité visuelle
