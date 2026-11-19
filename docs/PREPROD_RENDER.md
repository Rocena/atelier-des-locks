# Pré-production sur Render

Objectif : tester l'application en conditions de production avant de la mettre sur le vrai serveur.
Même `Dockerfile`, même base PostgreSQL, mêmes jobs (rappels, avis, purge RGPD).

> Vercel n'a pas été retenu : application Fastify à processus permanent (jobs `pg-boss`, purge,
> uploads sur disque), incompatible avec des fonctions serverless.

## Ce qui est identique à la production

Image Docker, HTTPS, base PostgreSQL, jobs en arrière-plan, migrations (`db:init`), vérifications de
configuration de production (`src/server/config.js`).

## Ce qui est différent

- Pas de Caddy : Render fournit le HTTPS et le proxy. `TRUST_PROXY` est donc réglé sur les adresses privées.
- Pas de sauvegardes chiffrées (`deploy/backup`) : inutiles pour des données de test.
- Photos téléversées : perdues à chaque déploiement, sauf si vous activez le disque (voir `render.yaml`).

## Étapes

1. Poussez le dépôt sur GitHub (privé). Vérifiez que `.env` n'est pas suivi : `git ls-files .env` ne doit rien afficher.
2. Sur render.com : **New → Blueprint**, choisissez le dépôt. Render lit `render.yaml`.
3. Renseignez les variables « à saisir » : `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `OWNER_EMAIL`, `PUBLIC_URL`.
   - Pour `PUBLIC_URL`, la première fois, mettez `https://atelier-des-locks-preprod.onrender.com`
     (ajustez si Render attribue un autre nom), puis redéployez si besoin.
   - Pour ne pas envoyer de vrais emails/SMS pendant les tests, utilisez une clé Brevo de test
     et votre propre adresse comme `OWNER_EMAIL`.
4. Lancez le déploiement. `preDeployCommand` applique les migrations et charge les contenus de départ.
5. Créez l'administratrice : onglet **Shell** du service, puis `node scripts/create-admin.js`.
6. Vérifiez : `/health` répond 200, le site s'affiche, une réservation de test arrive, l'email part,
   la connexion admin avec 2FA fonctionne.

## Points à valider pendant les tests

- Les adresses IP des visiteurs sont bien distinctes (rate limiting) : si une seule personne épuise la limite
  pour tout le monde, `TRUST_PROXY` doit être resserré sur les plages réelles de Render.
- Cookies `Secure` : la connexion admin ne doit pas boucler.
- Rappels et demandes d'avis : planifiez un rendez-vous proche et vérifiez l'envoi.
