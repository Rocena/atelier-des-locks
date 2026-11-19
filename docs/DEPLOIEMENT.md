# Mettre le site en ligne : guide pas à pas

> **Pour qui ?** Pour vous, sans connaissance technique. Chaque étape dit _quoi faire_, _pourquoi_, et _comment savoir que c'est réussi_.
> **Temps** : prévoyez une demi-journée pour la première fois (dont des temps d'attente : DNS, validation Brevo).
> **Rien n'est mis en ligne tant que vous n'avez pas lancé vous-même l'étape 9.** Tout ce qui précède se prépare sans que le site soit visible.
> Les commandes sont à copier-coller **une par une** dans le terminal du serveur. Si une commande affiche une erreur, arrêtez-vous et envoyez-moi le message exact : ne tentez pas de « corriger » au hasard.

---

## 0. Ce dont vous avez besoin de votre côté

Les trois premiers prennent du temps (délais d'attente) : **commencez-y dès maintenant**.

| #   | Quoi                                                                                       | Où / comment                                                                                                     | Coût indicatif\*                                                       | Délai                                               |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | **Un nom de domaine** (ex. `atelierdeslocks.fr`)                                           | OVHcloud, Gandi, Scaleway… (registrars français)                                                                 | 7 à 15 € / an                                                          | Immédiat                                            |
| 2   | **Un serveur (VPS) dans l'UE**                                                             | Scaleway (Paris), OVHcloud (France), Hetzner (Allemagne/Finlande). **2 Go de mémoire minimum**, Ubuntu 24.04 LTS | 5 à 12 € / mois                                                        | Quelques minutes                                    |
| 3   | **Un compte Brevo** (emails + SMS)                                                         | brevo.com (société française, données dans l'UE)                                                                 | Emails : offre gratuite suffisante au départ ; SMS : crédits à acheter | Validation du compte : de quelques heures à 2 jours |
| 4   | **Une adresse email pour recevoir les alertes de RDV**                                     | La vôtre (`OWNER_EMAIL`)                                                                                         | —                                                                      | —                                                   |
| 5   | **Un espace de stockage pour les sauvegardes hors serveur**                                | Scaleway Object Storage (Paris) ou OVH Object Storage. Recommandé, pas obligatoire                               | ≈ 1 € / mois                                                           | Quelques minutes                                    |
| 6   | **Un gestionnaire de mots de passe**                                                       | Bitwarden, 1Password, ou le trousseau de votre téléphone : pour ranger la **clé de sauvegarde** et les codes     | Gratuit                                                                | —                                                   |
| 7   | **Un ordinateur** avec Windows (PowerShell) ou Mac (Terminal) pour se connecter au serveur | Votre ordinateur                                                                                                 | —                                                                      | —                                                   |
| 8   | **Les informations légales** (SIRET, adresse, hébergeur…)                                  | Voir l'étape 11 : le site est **bloqué à l'ouverture** tant qu'elles manquent                                    | —                                                                      | —                                                   |
| 9   | _(facultatif)_ Un service de surveillance                                                  | Healthchecks.io ou UptimeRobot : il vous écrit si le site ou la sauvegarde s'arrête                              | Gratuit                                                                | —                                                   |

\* Tarifs à vérifier sur les sites : ils changent. L'ordre de grandeur total est de **10 à 20 € par mois** + le domaine + les SMS.

**Choisir la région du serveur** : Paris (Scaleway, OVH) ou tout pays de l'Union européenne. Le §14 du cahier des charges exige que les données restent dans l'UE.

**À me transmettre / à décider avant de commencer** (liste de la mission) :

- le nom de domaine choisi ;
- l'adresse IP du serveur (une fois loué) ;
- la clé API Brevo (à saisir **vous-même** sur le serveur, ne me l'envoyez pas) ;
- l'adresse d'envoi des emails (ex. `contact@votre-domaine.fr`) ;
- votre adresse pour les alertes de RDV et le lien de votre fiche Google pour les avis ;
- la décision « validation manuelle des RDV ou confirmation automatique » ;
- les informations légales et textes encore marqués « à confirmer » (étape 11).

---

## 1. Acheter le nom de domaine

1. Sur le site du registrar choisi, cherchez le nom voulu (idéalement en `.fr`), achetez-le.
2. Activez le **renouvellement automatique** (sinon le site disparaît un jour sans prévenir).
3. Notez l'adresse de connexion et mettez le mot de passe dans votre gestionnaire.

**Réussite** : vous voyez le domaine dans votre compte, avec un menu « Zone DNS » ou « DNS ».

## 2. Louer le serveur

1. Créez un compte chez l'hébergeur choisi, puis un **serveur / VPS / instance** : région **Paris** (ou UE), **Ubuntu 24.04 LTS**, **2 Go de mémoire au minimum**.
2. Quand l'hébergeur propose une **clé SSH**, laissez-le la générer ou suivez son assistant, **ou** choisissez un mot de passe très long. Gardez la clé dans votre gestionnaire de mots de passe.
3. Notez l'**adresse IP** du serveur (4 nombres séparés par des points, ex. `51.15.12.34`).
4. Activez, si l'hébergeur le propose, les **sauvegardes/instantanés du serveur** (une sécurité de plus, en plus des nôtres).

**Réussite** : le serveur est « en marche » et vous avez son adresse IP.

## 3. Brancher le domaine sur le serveur (DNS)

Dans la **zone DNS** du domaine, ajoutez deux lignes (supprimez d'abord toute ligne `A` ou `AAAA` existante pour `@` et `www`) :

| Type | Nom   | Valeur                  |
| ---- | ----- | ----------------------- |
| `A`  | `@`   | l'adresse IP du serveur |
| `A`  | `www` | l'adresse IP du serveur |

Le changement peut prendre de quelques minutes à quelques heures. **Vérifier** : dans un navigateur, tapez `https://dnschecker.org`, saisissez votre domaine : l'adresse du serveur doit apparaître.

> Ne pas ouvrir le domaine dans un navigateur à ce stade : il n'y a encore rien à voir.

## 4. Brevo : emails et SMS

À faire tôt : Brevo vérifie votre compte avant d'autoriser l'envoi.

1. Créez le compte sur brevo.com, validez l'email, remplissez le profil de l'entreprise (nom du salon, adresse).
2. **Authentifier le domaine d'envoi** : _Paramètres → Expéditeurs, domaines et IP dédiées → Domaines → Ajouter un domaine_. Brevo vous donne 3 ou 4 lignes (SPF, DKIM, DMARC) à recopier dans la **zone DNS** du domaine (étape 3). Cliquez sur « Authentifier ». C'est ce qui évite que les emails finissent dans les courriers indésirables.
3. **Ajouter l'expéditeur** : l'adresse qui apparaîtra comme expéditrice (ex. `contact@votre-domaine.fr`). Cette adresse devra exister (boîte mail ou alias) pour recevoir les réponses des clientes.
4. **Créer la clé API** : _Paramètres → SMTP & API → Clés API → Générer une clé_. Nommez-la « atelier-site ». **Copiez-la tout de suite** dans votre gestionnaire de mots de passe : Brevo ne la réaffiche plus. Si votre compte restreint les clés à certaines adresses IP, ajoutez l'IP du serveur.
5. **SMS** : _SMS → Acheter des crédits_ (un petit paquet suffit pour démarrer). Le nom d'expéditeur affiché sur les SMS est `AtelierLock` (11 caractères maximum) ; si Brevo vous demande de le déclarer, faites-le.

**Réussite** : le domaine est marqué « Authentifié » dans Brevo, vous avez une clé API (`xkeysib-…`) et des crédits SMS.

## 5. Préparer le serveur (une seule fois)

### 5.1 Se connecter

Ouvrez **PowerShell** (Windows : touche Windows, tapez `PowerShell`) ou **Terminal** (Mac), puis :

```bash
ssh root@ADRESSE_IP_DU_SERVEUR
```

Remplacez `ADRESSE_IP_DU_SERVEUR` par l'IP notée à l'étape 2. Répondez `yes` à la première question. Si l'hébergeur vous a donné un autre nom d'utilisateur que `root` (souvent `ubuntu`), utilisez-le à la place.

**Réussite** : l'invite de commande change et affiche le nom du serveur.

### 5.2 Mises à jour et protections de base

Une commande à la fois :

```bash
apt update && apt upgrade -y
```

```bash
apt install -y ufw fail2ban unattended-upgrades dnsutils unzip
```

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
```

Ce que cela fait : met le système à jour, active les **mises à jour de sécurité automatiques**, bloque les connexions répétées de pirates (`fail2ban`) et **ferme tous les ports sauf 22 (administration), 80 et 443 (le site)**.

### 5.3 Installer Docker (le programme qui fait tourner le site)

```bash
curl -fsSL https://get.docker.com | sh
```

Vérifier : `docker --version` affiche un numéro de version.

### 5.4 Créer un utilisateur dédié

Pour ne pas travailler en `root` au quotidien :

```bash
adduser --disabled-password --gecos "" atelier && usermod -aG docker atelier && rsync --archive --chown=atelier:atelier ~/.ssh /home/atelier
```

Puis déconnectez-vous (`exit`) et reconnectez-vous en tant que `atelier` :

```bash
ssh atelier@ADRESSE_IP_DU_SERVEUR
```

> Si l'hébergeur vous a seulement donné un mot de passe (pas de clé SSH), `rsync` n'aura rien à copier : donnez alors un mot de passe à l'utilisateur avec `passwd atelier` (en `root`), avant de vous reconnecter.

## 6. Envoyer le site sur le serveur

**Sur votre ordinateur** (pas sur le serveur), dans le dossier du projet, après que tout le travail a été « commité » (je le fais pour vous) :

```bash
git archive --format=zip -o atelier.zip HEAD
```

Cette commande fabrique une archive **sans** `node_modules` ni fichier de secrets. Envoyez-la :

```bash
scp atelier.zip atelier@ADRESSE_IP_DU_SERVEUR:~/
```

Puis **sur le serveur** :

```bash
mkdir -p ~/atelier && unzip -o ~/atelier.zip -d ~/atelier && cd ~/atelier && ls
```

**Réussite** : la liste contient `Dockerfile`, `docker-compose.prod.yml`, `docs`, `deploy`…

> **Plus tard** (mises à jour) : même procédure avec une nouvelle archive, puis `docker compose up -d --build` (voir §13). Un dépôt GitHub **privé** rendra cela plus simple ; je peux vous le préparer.

## 7. La clé de sauvegarde (étape la plus importante)

Les sauvegardes sont **chiffrées** : sans clé, elles sont illisibles, même pour quelqu'un qui volerait le serveur. Il y a deux clés :

- une **clé publique** (`age1…`) : elle sert à **écrire** les sauvegardes. Elle va sur le serveur. Elle ne peut rien déchiffrer ;
- une **clé privée** (`AGE-SECRET-KEY-…`) : elle sert à **relire** une sauvegarde. **Elle ne doit JAMAIS rester sur le serveur.** Si le serveur brûle, elle est ce qui vous sauve.

Générer la paire (le serveur l'affiche à l'écran, sans l'enregistrer nulle part) :

```bash
docker run --rm alpine sh -c "apk add -q age && age-keygen"
```

Vous voyez 3 lignes :

```
# created: 2026-...
# public key: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AGE-SECRET-KEY-1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

1. **Copiez les trois lignes** dans une note de votre gestionnaire de mots de passe, intitulée « Clé de sauvegarde Atelier des Locks ».
2. **Imprimez-les aussi** et rangez la feuille en lieu sûr (un incendie qui détruit l'ordinateur ne doit pas détruire la clé). Faites-en idéalement une **deuxième copie chez une personne de confiance**.
3. Gardez la ligne `age1…` (publique) à portée de main : elle va dans le fichier `.env` (étape 8).
4. Effacez l'écran : `clear`.

> **Sans la clé privée, les sauvegardes sont définitivement perdues.** Personne, ni moi ni l'hébergeur, ne peut les rouvrir. À l'inverse, **ne collez jamais la clé privée** dans un message, un email ou le fichier `.env`.

## 8. Remplir le fichier de réglages `.env`

Toujours dans `~/atelier` sur le serveur :

```bash
cp .env.production.example .env && chmod 600 .env
```

Les mots de passe se **génèrent** avec ces commandes (chacune affiche une valeur à copier) :

```bash
openssl rand -hex 24
```

→ à coller dans `POSTGRES_PASSWORD`.

```bash
openssl rand -base64 48 | tr '+/' '-_' | tr -d '='
```

→ à coller dans `SESSION_SECRET` (lancez la commande une seconde fois pour `ICAL_FEED_TOKEN`, si vous voulez l'agenda sur votre téléphone).

Ouvrez le fichier dans l'éditeur simple `nano` :

```bash
nano .env
```

Remplacez chaque `À REMPLIR`. Dans nano : flèches pour se déplacer, **Ctrl + O** puis **Entrée** pour enregistrer, **Ctrl + X** pour quitter.

| Variable                | Valeur                                                                  |
| ----------------------- | ----------------------------------------------------------------------- |
| `DOMAIN`                | votre domaine **sans** `https://` ni `www.`                             |
| `ACME_EMAIL`            | votre email (alertes de certificat)                                     |
| `POSTGRES_PASSWORD`     | généré ci-dessus (lettres et chiffres)                                  |
| `SESSION_SECRET`        | généré ci-dessus                                                        |
| `BREVO_API_KEY`         | la clé de l'étape 4                                                     |
| `BREVO_SENDER_EMAIL`    | l'expéditeur validé dans Brevo                                          |
| `OWNER_EMAIL`           | votre email pour les alertes de RDV                                     |
| `GOOGLE_REVIEW_URL`     | le lien « Laisser un avis » de votre fiche Google (facultatif au début) |
| `BACKUP_AGE_RECIPIENTS` | la ligne **publique** `age1…` de l'étape 7                              |

**Copie hors serveur (recommandée)** : dans l'espace de stockage Scaleway (Object Storage, région Paris), créez un « bucket » et une **clé d'accès**. Puis renseignez :

```
BACKUP_REMOTE=offsite:NOM-DU-BUCKET
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_PROVIDER=Scaleway
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=votre-identifiant-de-cle
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=votre-cle-secrete
RCLONE_CONFIG_OFFSITE_ENDPOINT=s3.fr-par.scw.cloud
RCLONE_CONFIG_OFFSITE_REGION=fr-par
```

(Chez OVH ou un autre fournisseur compatible S3 : demandez-moi les valeurs.) Cochez dans l'espace de stockage une règle d'expiration des anciens fichiers (par exemple 1 an) pour qu'il ne grossisse pas indéfiniment.

**Vérifier le fichier** (ne modifie rien, n'affiche aucun mot de passe) :

```bash
bash deploy/preflight.sh
```

Chaque ligne doit être **OK** (les « Attention » sont des conseils). S'il reste des « À CORRIGER », reprenez `nano .env`. Le contrôle vérifie aussi que le **domaine pointe bien vers le serveur** (étape 3).

## 9. Premier démarrage — le moment de la mise en ligne

> ⚠️ **C'est l'étape qui rend le site accessible à tous.** Ne la lancez que lorsque vous avez décidé de publier, après avoir lu l'étape 11. Avant d'ouvrir au public, vous pouvez parfaitement faire les étapes 9 et 10 puis tester vous-même le site : personne ne connaît encore l'adresse. Mais attention : les moteurs de recherche la découvriront vite, donc finissez l'étape 11 sans tarder.

**9.1 Construire le programme** (5 à 15 minutes, le serveur travaille) :

```bash
docker compose build
```

**9.2 Démarrer la base de données** :

```bash
docker compose up -d db
```

**9.3 Créer les tables et les contenus de départ** :

```bash
docker compose run --rm app node scripts/init-production.js
```

Vous devez lire : `Migrations appliquées : …` puis `Contenus de départ chargés (sans avis d'exemple)`. Les prix et durées chargés sont des **exemples** : vous les remplacerez dans l'admin (étape 11).

**9.4 Tout démarrer** :

```bash
docker compose up -d
```

**9.5 Vérifier** (attendre 1 minute que le certificat HTTPS soit obtenu) :

```bash
docker compose ps
```

Les 4 services (`db`, `app`, `caddy`, `backup`) doivent être `Up`, avec `(healthy)` pour `db` et `app`. Puis ouvrez `https://VOTRE-DOMAINE` dans un navigateur : le cadenas doit être fermé et le site s'afficher. `https://VOTRE-DOMAINE/health` doit afficher `{"status":"ok"}`.

**Contrôle des journaux de Caddy** (une seule fois) : `docker compose logs --tail 5 caddy` ne doit montrer **ni adresse IP, ni cookie**, et les adresses `/rdv/…` ne doivent plus montrer de jeton (juste `/rdv/`). Sinon, envoyez-moi ces lignes **avant** d'ouvrir au public.

**Si le site ne s'affiche pas** : `docker compose logs --tail 50 caddy` et `docker compose logs --tail 50 app`, puis envoyez-moi ces lignes (elles ne contiennent ni mots de passe ni données de clientes).

## 10. Créer votre compte administratrice

```bash
docker compose exec app node scripts/create-admin.js
```

Répondez aux questions (email, nom, mot de passe d'au moins 12 caractères : la saisie est invisible, c'est normal). Puis, sur votre **téléphone** :

1. Installez une **application d'authentification** (Google Authenticator, Microsoft Authenticator, Aegis…).
2. Ouvrez `https://VOTRE-DOMAINE/admin`, connectez-vous avec l'email et le mot de passe.
3. L'écran affiche un **QR code** : scannez-le avec l'application, puis saisissez le code à 6 chiffres.
4. L'écran affiche **10 codes de secours** : **notez-les** (gestionnaire de mots de passe + papier). Ils ne seront plus jamais réaffichés. Ils servent si vous perdez votre téléphone.

Pour la suite, voir [GUIDE_PROPRIETAIRE.md](GUIDE_PROPRIETAIRE.md).

## 11. Avant d'ouvrir au public : la liste de contrôle

À faire **depuis l'admin**, en vous connectant en tant que propriétaire. Le site contient des **exemples** (prix, durées, photos, chiffres) pour ne pas être vide :

- [ ] **Prestations et tarifs** : confirmer chaque **prix** et **durée** (le badge « à confirmer » disparaît quand c'est fait). Vérifier les options.
- [ ] **Réglages → Horaires** : vérifier les horaires d'ouverture (mardi–vendredi 9h–12h / 14h–18h, samedi 14h–18h, lundi et dimanche fermés par défaut).
- [ ] **Réglages → Réservation** : délai minimum (24 h), horizon (60 jours), délai d'annulation (48 h), validation manuelle ou automatique, texte de la politique de RDV.
- [ ] **Réglages → Coordonnées** : téléphone, WhatsApp, Instagram, adresse.
- [ ] **Contenus** : bandeau d'annonce ; **chiffres de l'accueil** (« 400 clientes », « 8 ans » sont provisoires) ; FAQ ; articles.
- [ ] **Galerie** : remplacer les visuels d'exemple par **vos** photos (texte alternatif obligatoire pour l'accessibilité).
- [ ] **Avis** : aucun avis d'exemple n'a été chargé en production. Les vrais avis arriveront par le formulaire envoyé après chaque rendez-vous terminé. Le site masque la section tant qu'il n'y en a pas.
- [ ] **Informations légales — OBLIGATOIRES** : les pages `Mentions légales`, `Confidentialité` et `CGV / politique de RDV` affichent encore des passages entre crochets (`[à compléter]`, `[à confirmer]`) : SIRET, forme juridique, adresse, email, **hébergeur** (le nom et l'adresse de la société qui loue votre serveur), durées de conservation. Un site public avec ces crochets n'est pas conforme. Ces textes sont dans le code du site : **donnez-moi les informations** et je les renseigne, puis vous renvoyez une archive (§13). Pour voir ce qui reste, sur le serveur :

  ```bash
  grep -rnE "à (compléter|confirmer)]" src/views | cut -c1-160
  ```

  (`bash deploy/preflight.sh` le signale aussi.)

- [ ] **Faire un vrai test de réservation** avec votre propre email et téléphone : confirmation reçue (email + SMS), alerte reçue sur `OWNER_EMAIL`, lien « Gérer mon RDV » fonctionnel. Dans l'admin, _Messages envoyés_ doit afficher les messages avec l'état « envoyé ». Annulez ensuite ce rendez-vous de test.
- [ ] **Tester les emails** dans Gmail, Outlook et Apple Mail (arrivée en boîte de réception, pas en courrier indésirable, affichage correct).
- [ ] **Première sauvegarde et répétition de restauration** (étape 12).
- [ ] **Mesurer la performance** : sur `pagespeed.web.dev`, tester l'accueil en mobile (objectif ≥ 90). La mesure faite pendant le développement était faussée par un ordinateur trop chargé.

## 12. Sauvegardes : vérifier qu'elles marchent, et savoir restaurer

### Ce qui se passe tout seul

Chaque nuit à **3 h 30** (heure de Paris), le service `backup` :

1. exporte la base (clientes, rendez-vous, avis, comptes, réglages) et archive les photos ;
2. **vérifie** que l'export est lisible et contient les tables essentielles (sinon : échec signalé, rien n'est gardé) ;
3. **chiffre** le tout avec votre clé publique ;
4. garde **14 jours** de sauvegardes quotidiennes, **8 semaines** (les dimanches) et **12 mois** (le 1er du mois) ;
5. copie les nouveaux fichiers **hors serveur** si vous l'avez configuré (étape 8).

Les fichiers sont dans `~/atelier/backups` (`atelier-db-AAAAMMJJ….dump.age` et `atelier-uploads-….tar.gz.age`).

### Faire la première sauvegarde maintenant

```bash
docker compose run --rm backup /ops/backup.sh
```

Vous devez lire `terminé : atelier-db-….dump.age`. Vérifiez la présence des fichiers : `ls -lh backups`.

### Répétition de restauration — **chaque mois**, et une première fois maintenant

C'est le seul vrai test : **une sauvegarde jamais restaurée n'est pas une sauvegarde**. Cette répétition **ne touche pas au site en ligne** : elle restaure dans une base temporaire, affiche des effectifs, puis la supprime.

1. Depuis **votre ordinateur**, envoyez temporairement la clé privée. Créez d'abord un fichier texte `cle-atelier.txt` contenant **uniquement la ligne** `AGE-SECRET-KEY-…` (copiée de votre gestionnaire), puis :

   ```bash
   scp cle-atelier.txt atelier@ADRESSE_IP_DU_SERVEUR:~/atelier/restore-key.txt
   ```

2. Sur le serveur :

   ```bash
   docker compose run --rm -v "$PWD/restore-key.txt:/keys/key.txt:ro" restore verify
   ```

3. **Réussite** : le texte se termine par `RÉPÉTITION RÉUSSIE`, avec des effectifs cohérents (nombre de prestations, de clientes, de rendez-vous). Sinon, **ne dites pas « ça va »** : envoyez-moi le message.

4. **Effacez la clé du serveur immédiatement**, puis supprimez `cle-atelier.txt` de votre ordinateur (corbeille comprise) :

   ```bash
   shred -u ~/atelier/restore-key.txt
   ```

Pour tester **aussi** les photos, ajoutez `--uploads backups/atelier-uploads-AAAAMMJJTHHMMSSZ.tar.gz.age` (nom exact visible avec `ls backups`) à la fin de la commande de l'étape 2, en remplaçant `backups/` par `/backups/`.

### Restaurer pour de vrai (panne, erreur, serveur perdu)

> À faire **avec moi** si possible. Cette opération **remplace** les données en ligne par celles de la sauvegarde choisie : tout ce qui est arrivé depuis (nouvelles réservations, par exemple) est perdu.

**A. Le serveur existe toujours** (base corrompue, mauvaise manipulation) :

1. Envoyez la clé privée comme ci-dessus (`restore-key.txt`).
2. Arrêtez le site : `docker compose stop app caddy`.
3. Restaurez (la sauvegarde la plus récente est choisie par défaut ; pour une autre, ajoutez `--db /backups/NOM-DU-FICHIER`) :

   ```bash
   docker compose run --rm -v "$PWD/restore-key.txt:/keys/key.txt:ro" restore live --yes-replace-live-data --uploads /backups/atelier-uploads-AAAAMMJJTHHMMSSZ.tar.gz.age
   ```

   Une **sauvegarde de sécurité de l'état actuel** est faite d'abord (`avant-restauration-db-….dump.age`).

4. Redémarrez : `docker compose up -d`, puis vérifiez le site et l'admin.
5. `shred -u ~/atelier/restore-key.txt` et supprimez la clé de votre ordinateur.

**B. Le serveur est perdu** (nouveau serveur) :

1. Refaites les étapes **2, 3 (nouvelle IP), 5, 6** et recréez le fichier `.env` **à l'identique** (gardez une copie de votre `.env` dans le gestionnaire de mots de passe : en particulier `SESSION_SECRET`, `ICAL_FEED_TOKEN`, `BACKUP_AGE_RECIPIENTS`).
2. Récupérez les fichiers `.age` depuis le stockage hors serveur (ou, à défaut, depuis les sauvegardes de l'hébergeur) dans `~/atelier/backups`.
3. `docker compose build && docker compose up -d db`, puis restaurez comme en A.3 (la base sera créée vide automatiquement).
4. `docker compose up -d`.

> **Avant la restauration**, les mêmes `SESSION_SECRET` et mêmes données sont nécessaires : les liens « Gérer mon RDV » des **rappels déjà planifiés** sont chiffrés avec `SESSION_SECRET`.

## 13. Au quotidien : commandes utiles

Toujours depuis `~/atelier` (après `ssh atelier@…`).

| Je veux…                                       | Commande                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Voir si tout va bien                           | `docker compose ps`                                                   |
| Lire les dernières lignes du site              | `docker compose logs --tail 100 app`                                  |
| Suivre le site en direct (Ctrl+C pour quitter) | `docker compose logs -f app`                                          |
| Voir l'état des sauvegardes                    | `ls -lh backups && cat backups/.last-success`                         |
| Redémarrer le site                             | `docker compose restart app`                                          |
| Mettre à jour le site (nouvelle archive)       | `unzip -o ~/atelier.zip -d ~/atelier && docker compose up -d --build` |
| Voir l'espace disque                           | `df -h /`                                                             |

**Journaux (logs)** : le site écrit un journal par ligne, **sans adresse IP, sans cookie, sans jeton de lien et sans paramètre d'adresse**. Ils restent sur le serveur, tournent automatiquement (5 fichiers de 10 Mo au plus par service) et disparaissent avec les anciens fichiers. Le journal d'activité de l'admin (qui a fait quoi) est visible dans _Journal d'activité_.

**Mise à jour du site** : après chaque nouvelle archive, `docker compose up -d --build` reconstruit et relance. Les migrations de base de données s'appliquent automatiquement au démarrage, **sans perte de données**. Faites une sauvegarde manuelle juste avant (`docker compose run --rm backup /ops/backup.sh`).

**Mises à jour de sécurité** : le système se met à jour seul (étape 5.2). Une fois par mois, reconstruisez l'image pour récupérer les correctifs de Node et de PostgreSQL : `docker compose pull && docker compose up -d --build`. Un redémarrage complet du serveur (`sudo reboot`) est parfois demandé après une mise à jour du noyau : le site redémarre tout seul.

### En cas de problème

| Symptôme                                    | Que faire                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Le site ne répond plus                      | `docker compose ps`, puis `docker compose logs --tail 50 app`. Essayez `docker compose restart app`. Si ça persiste, envoyez-moi les lignes. |
| Cadenas rouge / « connexion non sécurisée » | Le certificat n'a pas pu être obtenu : le domaine pointe-t-il bien vers le serveur (étape 3) ? `docker compose logs --tail 50 caddy`.        |
| `app` est « unhealthy »                     | La base est peut-être arrêtée : `docker compose ps db`, puis `docker compose up -d db`. L'adresse `/health` répond 503 dans ce cas.          |
| Les emails ne partent pas                   | Admin → _Messages envoyés_ : l'état « échec » indique pourquoi. Vérifiez la clé Brevo, l'expéditeur validé et les crédits SMS.               |
| Disque presque plein                        | `df -h /`, puis `docker system prune -f` (supprime seulement ce qui est inutilisé : jamais vos données).                                     |
| Vous avez perdu votre téléphone             | Connectez-vous avec un **code de secours** (étape 10). Si vous n'en avez plus : commande `--reset-2fa` ci-dessous.                           |
| Compte verrouillé (trop d'essais)           | Attendez (1 à 60 min selon le nombre d'échecs). Si urgent : commande `--unlock` ci-dessous.                                                  |

**Débloquer un compte ou réinitialiser sa double authentification** (en dernier recours) :

```bash
docker compose exec app node scripts/admin-recover.js --email votre@email.fr --unlock
```

`--unlock` remet à zéro le verrouillage. Pour une 2FA perdue (téléphone perdu **et** plus de codes de secours), remplacez `--unlock` par `--reset-2fa` : la personne devra scanner un nouveau QR code à sa prochaine connexion (ses sessions ouvertes sont fermées). L'opération est inscrite dans le journal.

## 14. Ce qu'il ne faut jamais faire

- Ne jamais **envoyer le fichier `.env`** par email, messagerie ou GitHub.
- Ne jamais **mettre la clé privée** de sauvegarde sur le serveur (sauf quelques minutes pour une restauration, puis `shred`).
- Ne jamais **changer `SESSION_SECRET`** sans m'en parler.
- Ne jamais **ouvrir le port 5432** (base de données) ni le port 3000 (application) dans le pare-feu de l'hébergeur : seuls 22, 80 et 443 doivent être ouverts.
- Ne jamais lancer `docker compose down -v` : le `-v` **supprime les volumes**, donc la base et les photos.
- Ne jamais partager votre compte admin : créez un compte « équipe » pour chaque employée.

## 15. Récapitulatif de ce qui est en place côté sécurité

| Exigence (§13)                     | Mise en œuvre en production                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS partout, HSTS                | Caddy : certificat Let's Encrypt automatique, redirection HTTP → HTTPS, HSTS posé par l'application                                           |
| Base non exposée                   | Aucun port publié ; réseau interne Docker sans accès à Internet                                                                               |
| Application non exposée            | Seul Caddy parle à l'application ; adresse du visiteur lue uniquement depuis Caddy (`TRUST_PROXY`)                                            |
| Secrets                            | Fichier `.env` (droits 600) sur le serveur, jamais dans l'image ni dans le dépôt ; l'application refuse de démarrer avec une valeur d'exemple |
| Conteneurs durcis                  | Utilisateur non-root, système de fichiers en lecture seule, capacités Linux supprimées, `no-new-privileges`                                   |
| Sauvegardes quotidiennes chiffrées | Voir l'étape 12 ; copies en clair uniquement en mémoire vive ; rotation 14 j / 8 sem. / 12 mois ; copie hors serveur                          |
| Test de restauration               | `restore verify` (mensuel) ; restauration réelle documentée, à répéter une fois sur le vrai serveur (étape 12)                                |
| Journaux sans donnée personnelle   | Application : ni IP, ni cookie, ni jeton ; Caddy filtré de même (à vérifier au premier démarrage, voir étape 9) ; rotation automatique        |
| Données dans l'UE                  | Serveur et stockage de sauvegarde dans l'UE ; Brevo (France)                                                                                  |
