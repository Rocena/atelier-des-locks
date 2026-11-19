# Module `notifications`

- **Rôle** : emails et SMS transactionnels (§7.6) : confirmation, déplacement/annulation, rappels J-2 (email) et J-1 18h (SMS), alerte propriétaire, demande d'avis (terminé + 3 h), relance J+5.
- **Interface** : `NotificationProvider` (`providers.js`) : `console` (dev, tests) et `brevo`. Jobs `pg-boss` (`queue.js`), un redémarrage ne perd rien.
- **Pur** : `plan.js` (quand, et faut-il encore envoyer ?), `messages.js` + `email-layout.js` (contenus, SMS ≤ 160 GSM), `seal.js` (jeton scellé AES-GCM dans les jobs).
- **Événements** : `app.notifications.appointmentBooked | Rescheduled | Cancelled | Completed` (ce dernier est à appeler par l'admin, phase 6). Ne lèvent jamais d'erreur.
- **Tables** : `notifications_log` (statut, erreur, tentatives, clé de dédoublonnage), `review_tokens`.
- **Sécurité** : jobs sans donnée personnelle ; jamais d'envoi en double par canal ; logs sans email ni téléphone.
