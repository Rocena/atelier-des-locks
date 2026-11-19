# Module `clients` (admin)

- **Rôle** : recherche, fiche (historique, notes), export CSV, suppression RGPD par anonymisation.
- **Pur** : `csv.js` (Excel français, BOM, protection contre l'injection de formules), `placeholder.js` (cliente sans email).
- **Droits** : lecture et notes pour l'équipe ; export et suppression pour la propriétaire.
- **Suppression** : identité, notes, photos (fichiers), jetons, destinataires des messages ; l'historique reste sans personne.
- **Journal** : l'export et la suppression sont tracés, sans nom ni adresse.
