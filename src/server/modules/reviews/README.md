# Module `reviews`

- **Rôle** : avis vérifiés (§8) : lecture publique, note moyenne, dépôt par lien à jeton, photo facultative, consentement, modération.
- **Routes** : `GET /avis` · `GET /api/reviews` · `GET|POST /avis/laisser/:token` · `GET /avis/photos/:id` (avis approuvés seulement).
- **Tables** : `reviews` (dépôt en `pending`, lecture : `approved`), `review_tokens` (SHA-256, 30 jours, usage unique).
- **Métier** : `service.js` (moyenne, jeton, dépôt transactionnel), `schemas.js` (Zod). Le lien est envoyé par `notifications`.
- **À venir (phase 6)** : modération en admin (approuver, refuser, répondre, mettre en avant).
- **Attention** : les 8 avis actuels sont des **exemples** (`is_placeholder`), à supprimer avant la mise en ligne.

**Admin (phase 6)** : `admin-routes.js` modération (publier, refuser), réponse publique, mise en avant ; jamais de publication sans consentement.
