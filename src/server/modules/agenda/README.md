# Module `agenda`

- **Rôle** : agenda de l'admin : vues jour, semaine, liste, rendez-vous saisi par le salon, déplacement, statuts, blocages.
- **Pur** : `timeline.js` (minutes depuis minuit, plages d'ouverture, bornes de la frise).
- **Service** : `createManual`, `moveAppointment` (nouveau lien « Gérer mon RDV » + notification), `changeStatus`, `addBlock`, `moveSlots`.
- **Anti-chevauchement** : contrainte PostgreSQL (`23P01`) ; un blocage est vérifié en plus.
- **Front** : `client/scripts/components/admin-agenda.js` (glisser-déposer souris ; au doigt, la fiche propose les créneaux libres).
- **Notifications** : jamais bloquantes ; case « prévenir la cliente » à chaque déplacement ou annulation.
