# Module `content`

- **Rôle** : articles « Conseils », FAQ du site, réglages d'affichage (annonce, fondatrice, chiffres) et blocs de texte éditables.
- **Routes** : `GET /conseils`, `/conseils/:slug` ; JSON : `GET /api/articles`, `/api/content/:key`.
- **Tables** : `articles`, `article_tags`, `tags`, `faq_groups`, `faq_items`, `settings` (clés `site.*`), `content_blocks`.
- **Métier** : `service.js` (tri des articles) ; les pages `site` lisent ce repo pour la FAQ et les réglages.
- **Brouillons** : un article n'est visible que si `status = 'published'`.
