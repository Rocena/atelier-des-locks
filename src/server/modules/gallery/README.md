# Module `gallery`

- **Rôle** : galerie des réalisations, filtrable par catégorie, méthode et taille (§5).
- **Routes** : `GET /galerie` (filtres d'URL validés par Zod, filtrage instantané côté client) ; JSON : `GET /api/gallery`.
- **Tables** : `gallery_items`, `tags` (taille), `gallery_item_tags`. `image_path` NULL = placeholder de marque.
- **Métier** : `service.js` (filtres, facettes), fonctions pures testées.
- **Photos** : aucune photo récupérée sur le web ; import des originales prévu (§12).

**Admin (phase 6)** : `admin-routes.js` envoi (une photo par requête, recadrée dans le navigateur), étiquettes, texte alternatif obligatoire, ordre ; `images.js` ré-encode en WebP (1600 px et 600 px) ; diffusion publique `/media/galerie/<uuid>.webp`.
