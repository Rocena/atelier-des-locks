# Module `catalog`

- **Rôle** : catégories, prestations et méthodes de locks (§6).
- **Routes** : `GET /prestations`, `GET /prestations/:slug`, `GET /methodes`, `GET /tarifs`.
- **Données** : phase 2 → `db/seeds/services.json`, `methods.json` ; phase 3 → tables `services`, `methods`.
- **Métier** : `service.js` (regroupement, suggestions, méga-menu, JSON-LD), fonctions pures testées.
- **Prix** : valeurs d'exemple (`isPlaceholder`), badge « à confirmer » uniquement en admin.
