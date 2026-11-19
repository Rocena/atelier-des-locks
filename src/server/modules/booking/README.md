# Module `booking`

- **Rôle** : réservation interne (§7) : créneaux, création, « Gérer mon RDV », .ics, flux iCal privé. Adaptateur `BOOKING_PROVIDER` (`internal` | `fresha_link`).
- **Routes** : `GET /reserver`, `GET /api/booking/slots`, `GET /api/booking/challenge`, `POST /api/booking/appointments` ; `GET /rdv/:token`, `GET|POST /rdv/:token/deplacer`, `POST /rdv/:token/annuler`, `GET /rdv/:token/rdv.ics` ; `GET /agenda/:token.ics`.
- **Métier pur** : `availability.js` (moteur de disponibilités), `policy.js` (durée, prix, annulation), `ics.js`, `anti-bot.js`, `tokens.js`, `upload.js`.
- **Tables** : `appointments`, `appointment_options`, `clients`, `staff`, `staff_services`, `opening_hours`, `closures`, `blocks`, `settings` (`booking.*`).
- **Double réservation** : revalidation dans une transaction + contrainte `appointments_no_overlap` (23P01 → 409).
- **Sécurité** : CSRF, rate limit, pot de miel, preuve de travail, jetons hachés (SHA-256), photo ré-encodée par sharp hors webroot.
