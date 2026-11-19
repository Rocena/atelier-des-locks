# Module `reviews`

- **Rôle** : lecture des avis publiés, note moyenne et répartition (§8).
- **Routes** : `GET /avis` ; JSON : `GET /api/reviews`. À venir : `/avis/laisser/:token` (dépôt, modération).
- **Tables** : `reviews` (lecture : `status = 'approved'`), `review_tokens` (phase avis).
- **Métier** : `service.js` (moyenne, répartition, mise en avant), testé.
- **Attention** : les 8 avis actuels sont des **exemples** (`is_placeholder`), à remplacer avant la mise en ligne.
