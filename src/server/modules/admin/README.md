# Module `admin` (coque du back-office)

- **Rôle** : tout ce qui est sous `/admin` : garde d'accès, rendu des pages privées, navigation par rôle.
- **Garde** (`guard.js`) : chaque route déclare `config: { roles: OWNER | ANY }` ; sans rôle = refus. 401 sans session complète, 403 si le rôle ne suffit pas.
- **Rendu** : `reply.adminPage('admin/<gabarit>', données)` (layout sobre, jeton CSRF, navigation filtrée, confirmation `?ok=clé`).
- **Formulaires génériques** : `forms.js` décrit les champs, `views/admin/formulaire.eta` les rend.
- **Pur** : `order.js` (ordre des listes), `format.js` (libellés, dates de Paris), `nav.js`.
- **Tests** : `access.test.js` (matrice d'accès lue dans l'application), `flows.test.js` (parcours HTTP), `pure.test.js`.
- Décisions : `docs/decisions/0002-admin-auth-and-access.md`.
