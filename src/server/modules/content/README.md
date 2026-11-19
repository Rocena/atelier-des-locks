# Module `content`

- **Rôle** : articles « Conseils », FAQ du site, réglages d'affichage (annonce, fondatrice, chiffres) et blocs de texte éditables.
- **Routes** : `GET /conseils`, `/conseils/:slug` ; JSON : `GET /api/articles`, `/api/content/:key`.
- **Tables** : `articles`, `article_tags`, `tags`, `faq_groups`, `faq_items`, `settings` (clés `site.*`), `content_blocks`.
- **Métier** : `service.js` (tri des articles) ; les pages `site` lisent ce repo pour la FAQ et les réglages.
- **Brouillons** : un article n'est visible que si `status = 'published'`.

**Admin (phase 6)** : `admin-routes.js` bandeau d'annonce, chiffres et fondatrice, FAQ, articles du journal, étapes de la vie d'une loc.
