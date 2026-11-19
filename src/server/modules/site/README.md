# Module `site`

- **Rôle** : pages éditoriales (accueil, le salon, contact, FAQ, vitrine de réservation, pages légales), `sitemap.xml`, `robots.txt`.
- **Routes** : `GET /`, `/le-salon`, `/contact`, `/faq`, `/reserver`, `/mentions-legales`, `/confidentialite`, `/cgv-politique-rdv`, `/sitemap.xml`, `/robots.txt`.
- **Données** : phase 2 → `db/seeds/settings.json`, `faq.json` ; phase 3 → tables `settings`, `faq_items`.
- **Métier** : `service.js` (JSON-LD `HairSalon` et `FAQPage`, sitemap), testé.
- **Dépendances** : lit les repos `catalog`, `gallery`, `reviews`, `journal` pour l'accueil.
