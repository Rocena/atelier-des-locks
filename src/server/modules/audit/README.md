# Module `audit`

- **Rôle** : journal d'activité (qui a fait quoi) et journal des messages envoyés, en lecture pour la propriétaire.
- **Écriture** : `audit(request, 'domaine.action', { type, id, details })`, jamais bloquant ; filtre sur les clés sensibles (mot de passe, code, jeton…).
- **Base** : `audit_log` en ajout seul (déclencheur) ; destinataires des messages masqués à l'affichage.
