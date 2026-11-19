# ADR 0002 : authentification et contrôle d'accès du back-office

- Statut : accepté (phase 6)
- Contexte : §9 et §13 du cahier des charges. L'espace pro est utilisé surtout sur téléphone, par une personne (propriétaire) et plus tard par des employées.

## Décisions

1. **Rendu serveur (Eta) + formulaires classiques**, JavaScript en amélioration (frise de l'agenda, glisser-déposer, envoi de photos). Tout marche au toucher et au clavier sans glisser-déposer : boutons ↑ ↓, « Choisir un autre créneau ». Pas de SPA.
2. **Sessions serveur en base**, pas de JWT : révocation immédiate, rotation de l'identifiant à chaque changement de niveau (mot de passe → 2FA), expiration à 30 min d'inactivité et 12 h au maximum.
3. **argon2id** via `@node-rs/argon2` (binaires précompilés, pas de compilation native sous Windows).
4. **TOTP maison** (RFC 6238, une cinquantaine de lignes sur `node:crypto`, testé avec les vecteurs de la RFC) plutôt qu'une dépendance. Secret chiffré au repos (AES-256-GCM, clé dérivée de `SESSION_SECRET`), pas de rejeu (`totp_last_step`), codes de secours hachés avec une clé du serveur. QR code généré côté serveur (`qrcode`), SVG sans style en ligne.
5. **Rôle déclaré route par route** (`config.roles`), **refus par défaut** : une route oubliée est inaccessible, et un test lit la liste réelle des routes pour le prouver. Les rôles : `owner` (tout) et `staff` (agenda, clientes en lecture et notes, galerie, avis, tableau de bord sans chiffre d'affaires).
6. **CSRF** : le plugin existant (cookie signé, jeton en en-tête `x-csrf-token` ou champ `_csrf`) sur toute écriture ; le cookie de session est `SameSite=Strict`.
7. **Réponses 401 / 403** : 401 pour toute requête sans session complète (page HTML dédiée pour une navigation), 403 pour un rôle insuffisant.
8. **Suppression RGPD = anonymisation** : l'historique (dates, prestations, montants) est gardé sans lien avec une personne ; les rendez-vous à venir sont annulés sans message.
9. **Cliente sans email** (rendez-vous par téléphone) : l'email unique de la base est fabriqué sur un domaine réservé (`sans-email.invalid`) ; les notifications l'ignorent, les SMS partent, l'export et l'écran ne l'affichent jamais.
10. **Déplacement par l'admin** : le lien « Gérer mon RDV » est renouvelé (la base ne garde que l'empreinte, le jeton en clair d'avant n'existe plus) ; les rappels du nouveau rendez-vous contiennent le nouveau lien.

## Conséquences

- Réglages d'infrastructure (`BOOKING_PROVIDER`, lien Fresha, lien avis Google, fournisseur d'envoi) : restent dans l'environnement et sont affichés en lecture seule.
- Textes des emails et SMS : toujours dans `messages.js` (garde-fous de longueur et de lien à conserver). Édition depuis l'admin : phase suivante.
- Valider un rendez-vous « à valider » n'envoie pas encore de message dédié (pas de modèle « rendez-vous validé »).
