# retention

Purge quotidienne RGPD (§14), lancée par `index.js` : clientes inactives anonymisées (réglage
`privacy.client_retention_years`, 3 ans par défaut), photos de cheveux à 1 an, destinataires des envois
et adresses IP à 12 mois, sessions expirées. SQL dans `repo.js` ; durées dans `docs/DATABASE.md`.
