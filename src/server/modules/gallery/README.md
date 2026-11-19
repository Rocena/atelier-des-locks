# Module `gallery`

- **Rôle** : galerie des réalisations, filtrable par catégorie, méthode et taille (§5).
- **Routes** : `GET /galerie` (filtres d'URL validés par Zod, filtrage instantané côté client) ; JSON : `GET /api/gallery`.
- **Tables** : `gallery_items`, `tags` (taille), `gallery_item_tags`. `image_path` NULL = placeholder de marque.
- **Métier** : `service.js` (filtres, facettes), fonctions pures testées.
- **Photos** : aucune photo récupérée sur le web ; import des originales prévu (§12).
