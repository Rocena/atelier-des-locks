# Module `services`

- **Rôle** : catégories, prestations, options, méthodes de locks et FAQ par prestation (§6).
- **Routes** : `GET /prestations`, `/prestations/:slug`, `/methodes`, `/tarifs` ; JSON : `GET /api/services[?categorie=]`, `/api/services/:slug`.
- **Tables** : `categories`, `services`, `service_options`, `service_photos`, `methods`, `service_methods`, `faq_items` (+ `content_blocks` : étapes).
- **Métier** : `service.js` (regroupement, suggestions, méga-menu, JSON-LD), fonctions pures testées.
- **Prix** : en centimes en base, en euros dans le code. `isPlaceholder` jamais exposé côté public (badge « à confirmer » en admin).
