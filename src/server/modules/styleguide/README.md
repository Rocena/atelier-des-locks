# Module `styleguide`

- **Rôle** : page de référence du design system (tokens, composants, états, clair/sombre).
- **Routes** : `GET /styleguide` (en-tête `X-Robots-Tag: noindex`).
- **Activation** : `STYLEGUIDE_ENABLED` (par défaut `true` hors production, `false` en production).
- **Tables** : aucune.
- **Dépendances** : `src/views/pages/styleguide.eta`, entrée Vite `styleguide`.
