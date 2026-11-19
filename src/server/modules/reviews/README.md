# Module `reviews`

- **Rôle** : avis clientes publiés, note moyenne et répartition (§8).
- **Routes** : `GET /avis`. À venir : `GET/POST /avis/laisser/:token` (phase avis).
- **Données** : phase 2 → `db/seeds/reviews.json` (**avis d'exemple, à remplacer avant la mise en ligne**).
- **Métier** : `service.js` (moyenne, répartition, mise en avant), testé.
