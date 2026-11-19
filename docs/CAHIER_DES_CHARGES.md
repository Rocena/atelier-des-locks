# Cahier des charges : site & plateforme L'Atelier des Locks

> Document de référence du projet. Toute décision technique ou design doit s'y conformer.
> Si une décision s'en écarte, la consigner dans `docs/decisions/` (format ADR) et mettre ce fichier à jour.

---

## 1. Contexte

- **Client** : **L'Atelier des Locks** (anciennement « Glow in Locks » au Sénégal), salon de coiffure pour cheveux afro, pour femmes, à **Toulouse**.
- **Spécialité** : les **locks** (installation, entretien, soins, coloration, coiffure).
- **Histoire** : la fondatrice est locticienne. Elle a d'abord exercé à **Dakar** avant d'ouvrir à Toulouse. La marque est désormais française (« l'atelier », le savoir-faire artisanal) ; l'héritage de Dakar se raconte sur la page « Le salon », mais ne fait pas partie du nom (cf. `brand/BRAND.md`).
- **Outil actuel** : la fondatrice gère ses rendez-vous sur **Fresha**.
- **Cible** : femmes de 20 à 55 ans aux cheveux afro, crépus ou bouclés. Elles ont déjà des locks, ou envisagent d'en faire et ont besoin d'être rassurées et guidées. Elles réservent surtout depuis leur mobile, souvent après avoir vu Instagram.

## 2. Objectifs

1. **Émotion** : les visiteuses doivent tomber amoureuses du site. Il doit être premium, chic, beau et fièrement afro.
2. **Conversion** : réserver un rendez-vous en moins de 2 minutes sur mobile.
3. **Autonomie** : la propriétaire gère elle-même services, tarifs, galerie, rendez-vous et avis, sans développeur.
4. **Confiance** : avis clientes réels, réalisations, pédagogie sur les méthodes.
5. **SEO local** : bien se positionner sur « locks Toulouse », « locticienne Toulouse », « microlocks Toulouse », « resserrage locks Toulouse », « salon cheveux afro Toulouse ».
6. **Évolutivité** : un code lisible par n'importe quel humain ou agent IA, modulaire, documenté.

## 3. Références

| Site | Ce qu'on retient | Ce qu'on fait mieux |
|---|---|---|
| raissadora.com/collections/evenements | Navigation claire par grandes catégories, menu tiroir mobile fluide, bandeau d'annonce, réassurance (avis, social proof), footer riche (FAQ, newsletter, réseaux) | Des transitions de page et des micro-interactions bien plus abouties |
| twistsandlocks.com | Structure métier : à propos, fondatrice, services (installation, resserrage, soins holistiques, événements, produits, formation), tarifs, galerie, témoignages, réservation via Fresha, WhatsApp | Design éditorial premium, vraie galerie filtrable, avis vérifiés, réservation intégrée, zéro lorem ipsum |

## 4. Identité visuelle

Tout est fourni dans `brand/` : logos SVG, emblème (évolution du logo historique : profil de femme aux locks sur un soleil terre cuite), favicon, et `BRAND.md` (palette, typographies, motifs, direction photo). **Respecter `BRAND.md` à la lettre.**

**Direction artistique** : « Éditorial afro-luxe ». Un magazine de mode qui serait aussi un salon :
- l'esprit d'une **maison de couture** appliqué à la loc ; de grands titres en Bodoni Moda avec un mot-clé en *italique terre cuite* ;
- beaucoup d'air, des fonds karité avec grain, des sections ébène pour le contraste ;
- des portraits dans des arches, des mises en page asymétriques ;
- l'élément signature, **le fil de loc** (ligne SVG striée qui se dessine au scroll et relie les sections) ;
- le motif bogolan en filigrane.

Le skill `.claude/skills/design-craft/SKILL.md` s'applique à **tout** le front-end (public et admin).

## 5. Arborescence du site public

```
/                         Accueil
/le-salon                 Notre histoire (Dakar → Toulouse), la fondatrice, l'approche, le lieu
/prestations              Toutes les prestations (par catégorie)
/prestations/[slug]       Détail d'une prestation (description, méthodes, durée, prix, photos, FAQ, CTA réserver)
/methodes                 Guide des méthodes de locks (pédagogique, SEO)
/galerie                  Réalisations filtrables (catégorie, méthode, taille)
/tarifs                   Grille tarifaire complète
/avis                     Avis clientes vérifiés + note moyenne
/reserver                 Tunnel de réservation
/rdv/[token]              Gérer mon rendez-vous (voir, déplacer, annuler)
/avis/laisser/[token]     Formulaire d'avis post-rendez-vous
/conseils                 Journal / blog (prévu dès la v1, peut démarrer avec 2–3 articles)
/contact                  Adresse, plan, horaires, WhatsApp, formulaire
/faq                      FAQ (préparation, durée, entretien, annulation…)
/mentions-legales, /confidentialite, /cgv-politique-rdv
/admin/...                Back-office (cf. §9)
```

### Accueil : déroulé

1. **Hero plein écran** : portrait (photo ou vidéo courte en boucle, muette). Titre révélé ligne par ligne, par exemple « L'art de la *loc*, à Toulouse. » Sous-titre « Création, entretien et soin des locks, par une locticienne passionnée. » CTA principal « Réserver », CTA secondaire « Découvrir les prestations ».
2. **Bandeau de réassurance** défilant lentement : note moyenne, nombre de clientes, spécialiste locks, Toulouse.
3. **Manifeste / histoire** courte, en mise en page éditoriale asymétrique, avec la photo de la fondatrice dans une arche.
4. **Prestations** : 5 grandes cartes (installation, resserrage, détox, coloration, coiffure) avec révélation d'image au survol ou au scroll.
5. **Méthodes** : carrousel horizontal piloté par le scroll, une méthode par panneau.
6. **Galerie** : sélection en masonry ou en défilement horizontal, avec lightbox.
7. **Avis** : 3 à 6 avis mis en avant, avec la note.
8. **Le parcours d'une cliente** : consultation → installation → entretien → sublimer.
9. **Instagram** : grille de liens vers ses posts (cf. §12).
10. **CTA final** sur fond ébène, puis le footer.

## 6. Prestations (données initiales, modifiables en admin)

> ⚠️ **Les prix et durées ci-dessous sont des valeurs d'exemple à faire valider par la propriétaire.**
> Les marquer `is_placeholder = true` en base et afficher un badge « à confirmer » **uniquement en admin**.
> Pour mémoire, des salons toulousains concurrents affichent sur Fresha environ 60 € pour « retwist + coiffure » et 80 € pour « détox + retwist + coiffure ».

### Catégories et méthodes

**1. Installation (création de locks)**
- Comb coils (vanilles au peigne), pour cheveux courts
- Two-strand twists (vanilles deux brins)
- Tresses (braid locks)
- Interlocking (au crochet / outil, depuis la racine)
- Crochet / instant locks (locks instantanées au crochet)
- Backcombing (crêpage)
- Microlocks (petites locks, montées au twist, à l'interlocking ou en tresses)
- Extensions de locks (naturelles ou synthétiques)
- Freeform (accompagnement de locks libres)
- ⚠️ Ne **pas** utiliser le terme « Sisterlocks™ » (marque déposée, réservée aux consultantes certifiées) sauf si la propriétaire est certifiée. Parler de « micro-locks à l'interlocking ».

**2. Resserrage / entretien (retwist)**
- Palm rolling (roulage entre les paumes, avec produit)
- Interlocking (resserrage à l'outil, plus durable)
- Crochet (resserrage et réparation)
- Réparation de locks abîmées, fusion, reprise de racines

**3. Locks détox**
- Bain détox (clarifiant : bicarbonate, vinaigre de cidre, argile…, à faire préciser par la propriétaire)
- Détox + resserrage
- Soin profond / hydratation

**4. Coloration**
- Coloration complète, mèches, pointes, décoloration
- Note : prévoir un champ « test d'allergie requis 48h avant » (booléen par service)

**5. Coiffure**
- Coiffures sur locks : chignons, pétales, barrel, tresses de locks, coiffures de soirée
- Coiffure mariage / événement (sur devis)

**Hors catégories** : consultation / diagnostic (en salon ou en visio), départ de locks (sur devis).

### Modèle d'une prestation

`nom`, `slug`, `catégorie`, `méthodes[]`, `description courte`, `description longue` (riche), `durée min`, `durée max`, `temps tampon après`, `prix` (fixe ou « à partir de »), `sur devis` (bool), `acompte` (montant, optionnel, pour la phase future), `photos[]`, `FAQ[]`, `actif` (bool), `réservable en ligne` (bool), `ordre`, `test allergie requis` (bool), `options / suppléments` (ex. longueur > épaules + X €, extensions fournies + X €).

## 7. Module de réservation

### 7.1 Fresha : constat et décision

- Fresha **n'offre pas d'API publique** pour les salons. On peut seulement générer un **lien de réservation** (« Link builder », qui exige un profil listé sur la marketplace) ou utiliser son widget, dont le design n'est pas personnalisable.
- On ne peut donc **pas** synchroniser automatiquement les deux agendas.

**Décision** : on construit **notre propre module de réservation**, qui devient la source de vérité. Il est conçu avec un **adaptateur** pour basculer facilement :

```
BOOKING_PROVIDER=internal       # notre module (par défaut)
BOOKING_PROVIDER=fresha_link    # les boutons "Réserver" ouvrent le lien Fresha (FRESHA_BOOKING_URL)
```

**Transition** : la propriétaire désactive la prise de RDV en ligne sur Fresha (ou bloque son agenda Fresha) quand le module interne passe en production, pour éviter les doubles réservations. Le module expose aussi un **flux iCal privé** (URL secrète) qu'elle peut ajouter à son téléphone ou Google Agenda.

### 7.2 Parcours cliente (mobile-first, 4 étapes, barre de progression)

1. **Prestation** : catégorie → prestation → options (longueur, extensions…). Durée et prix estimés affichés en direct.
2. **Date et heure** : calendrier des disponibilités réelles (créneaux calculés côté serveur). Afficher clairement la durée (ex. « 5h – 7h »).
3. **Informations** :
   - prénom, nom, email, téléphone (format FR et international), état actuel des cheveux (liste), photo de ses cheveux (optionnelle mais encouragée : la locticienne prépare mieux le RDV), notes ;
   - cases : acceptation de la politique de RDV (obligatoire) ; rappels SMS (transactionnels, cochée par défaut) ; newsletter (opt-in séparé, **non cochée**).
4. **Confirmation** : récapitulatif, conseils de préparation (« venir cheveux propres et démêlés », etc.), ajout au calendrier (.ics, Google), lien « Gérer mon RDV ».

### 7.3 Moteur de disponibilités (logique serveur, à tester unitairement)

- Horaires d'ouverture hebdomadaires (plusieurs plages par jour possibles).
- Exceptions : jours fermés, congés, horaires spéciaux.
- Blocages manuels (pause, rendez-vous perso).
- Durée = durée max de la prestation + options + tampon. Prestations longues (4 à 9h) gérées correctement.
- Pas de chevauchement. Délai minimum avant réservation (ex. 24h) et horizon max (ex. 60 jours), réglables.
- **Multi-praticiennes prêt** : table `staff` dès la v1, même s'il n'y a qu'une seule locticienne au départ.
- Fuseau horaire `Europe/Paris`, stockage UTC (`timestamptz`), gestion du changement d'heure.
- Anti-double-réservation : contrainte d'exclusion PostgreSQL (`EXCLUDE USING gist` sur `tstzrange` par `staff_id`) **et** transaction.

### 7.4 Statuts d'un RDV

`en_attente` (si validation manuelle activée) → `confirmé` → `terminé` | `annulé_cliente` | `annulé_salon` | `absent` (no-show).

### 7.5 Politique d'annulation

Paramétrable : annulation et déplacement gratuits jusqu'à X heures avant (défaut 48h). Ensuite, plus de self-service et un message pour appeler le salon. Texte éditable en admin.

### 7.6 Notifications (email + SMS)

**Fournisseur recommandé : Brevo** (entreprise française, emails et SMS transactionnels, conforme RGPD). Passer par une interface `NotificationProvider` pour pouvoir en changer.

| Déclencheur | Email | SMS |
|---|---|---|
| RDV créé | Confirmation + .ics + lien gérer | Confirmation courte |
| RDV déplacé ou annulé | ✅ | ✅ |
| J-2 | Rappel + conseils de préparation | — |
| J-1 (18h) | — | Rappel |
| Nouveau RDV (pour la propriétaire) | ✅ | optionnel |
| Statut → `terminé` + 3h | **Demande d'avis** (lien unique) | optionnel |
| Avis non laissé, J+5 | 1 relance unique | — |

- Envois par **file de tâches persistante** (`pg-boss`, sur PostgreSQL) avec retries. Si le serveur redémarre, aucun rappel n'est perdu.
- Les modèles d'emails sont aux couleurs de la marque (HTML responsive, testés sur Gmail, Outlook et Apple Mail). Leurs textes sont éditables en admin.
- Les SMS partent avec un expéditeur alphanumérique « AtelierLock » (11 caractères maximum), ne dépassent pas 160 caractères et ne contiennent pas de mention STOP (ce sont des messages transactionnels).
- Les envois sont journalisés (statut, date, erreur) et visibles en admin.

## 8. Avis clientes

- Seules les clientes qui ont eu un RDV `terminé` peuvent laisser un avis, via un **lien à jeton unique** (usage unique, expiration 30 jours). Ce sont des **avis vérifiés**.
- Formulaire : note de 1 à 5 étoiles, texte, prénom + initiale, photo du résultat (optionnelle), consentement à la publication.
- **Modération** en admin : approuver, refuser, répondre publiquement, mettre en avant.
- Affichage : page `/avis`, avis sur l'accueil et sur chaque prestation concernée, note moyenne calculée.
- Après l'envoi, proposer aussi de laisser un avis Google (lien configurable).
- Ne jamais inventer d'avis. Tant qu'il n'y en a pas, masquer les blocs ou afficher « Les premiers avis arrivent bientôt ».

## 9. Back-office (admin)

Accès `/admin`, réservé à la propriétaire (et à de futures employées, avec rôles).

**Tableau de bord** : RDV du jour et de la semaine, CA estimé du mois, nouveaux avis à modérer, taux de no-show.

**Agenda** :
- vues jour, semaine et liste ; glisser-déposer pour déplacer un RDV (avec notification à la cliente) ;
- création manuelle d'un RDV (téléphone, WhatsApp), blocage de créneaux ;
- fiche RDV : changer le statut, notes internes, photos.

**Clientes** : fiche avec historique des RDV, notes (type de cheveux, méthode utilisée, produits), recherche, export CSV, suppression RGPD.

**Prestations et tarifs** : CRUD catégories, prestations, méthodes et options ; ordre par glisser-déposer ; activer ou désactiver.

**Galerie** : upload multiple (glisser-déposer), recadrage, tags (catégorie, méthode), texte alternatif (requis, avec suggestion), ordre, mise en avant sur l'accueil.

**Avis** : modération (cf. §8).

**Contenus** : textes clés de l'accueil et de « Le salon », FAQ, bandeau d'annonce, articles du journal.

**Réglages** : horaires, congés, délais, politique d'annulation, modèles d'emails et de SMS, coordonnées, liens réseaux, `BOOKING_PROVIDER`, lien Fresha, lien avis Google.

**Journal d'activité** (audit log) : qui a fait quoi, et quand.

UX admin : **simple, mobile-first** (la propriétaire l'utilisera entre deux clientes, sur téléphone), même identité visuelle en plus sobre.

## 10. Stack technique

Contrainte client : **HTML, CSS, JavaScript + base SQL**. Pas de framework lourd, du code lisible.

| Couche | Choix | Pourquoi |
|---|---|---|
| Front public | HTML + CSS moderne (custom properties, `@layer`, container queries) + **JavaScript vanilla** (modules ES) | Simple, rapide, lisible par tous |
| Build | **Vite** (multi-pages) | Dev server, bundling, optimisation des assets |
| Templating / SSR | Pages rendues côté serveur avec un moteur de templates simple (**Eta** ou `@fastify/view`) | SEO, contenus dynamiques (prestations, avis) |
| Animations | **GSAP** (ScrollTrigger, SplitText) + **Lenis** (smooth scroll) + **View Transitions API** pour les transitions de page | Rendu haut de gamme, maîtrisé |
| Back-end | **Node.js LTS + Fastify** | Rapide, schémas de validation intégrés, écosystème sécurité |
| Base de données | **PostgreSQL 16+**, SQL écrit à la main (driver `pg`, requêtes paramétrées), migrations SQL versionnées | « SQL » explicite et lisible, sans ORM magique |
| Validation | **Zod** (partagé front et back) | Une seule source de vérité pour les formats |
| Jobs | **pg-boss** | File persistante sans Redis |
| Email / SMS | **Brevo** via adaptateur | FR, RGPD, deux canaux |
| Images | **sharp** (redimensionnement, AVIF/WebP, suppression EXIF) | Performance et vie privée |
| Typage | JavaScript + **JSDoc** + `// @ts-check` (`checkJs` dans `jsconfig.json`) | Typage pour humains et IA sans étape TypeScript |
| Tests | **Vitest** (unitaires et intégration) + **Playwright** (e2e : réservation, admin) | Sécurise les évolutions |
| Qualité | ESLint + Prettier + Husky (pre-commit) | Code homogène |
| Dev / déploiement | **Docker Compose** (app + Postgres), déploiement sur VPS en France ou UE (Scaleway, OVH…) ou PaaS UE, HTTPS (Caddy) | Données hébergées en UE |
| Analytics | **Plausible** ou **Umami** (sans cookies) | Pas de bandeau cookies nécessaire |

## 11. Architecture du code (lisible par humains et IA)

```
/
├── CLAUDE.md                 # Règles pour agents IA (court, pointe vers docs/)
├── AGENTS.md                 # Même contenu (autres agents) ou lien vers CLAUDE.md
├── README.md                 # Démarrage en 5 minutes
├── docs/
│   ├── CAHIER_DES_CHARGES.md
│   ├── ARCHITECTURE.md       # Schéma des modules, flux de données
│   ├── DATABASE.md           # Schéma des tables, généré ou maintenu
│   ├── SECURITY.md
│   ├── PROGRESS.md           # Journal d'avancement par phase
│   └── decisions/            # ADR : 0001-booking-internal-vs-fresha.md…
├── brand/                    # Logos, BRAND.md
├── .claude/skills/design-craft/SKILL.md
├── src/
│   ├── server/
│   │   ├── app.js            # Création de l'app Fastify, plugins
│   │   ├── config.js         # Lecture et validation de l'env (zod)
│   │   ├── db/               # pool pg, migrations/*.sql, seeds/
│   │   ├── modules/          # 1 dossier = 1 domaine métier
│   │   │   ├── services/     # routes.js, service.js, repo.js (SQL), schemas.js, README.md, *.test.js
│   │   │   ├── booking/      # + availability.js (moteur pur, testé)
│   │   │   ├── clients/
│   │   │   ├── reviews/
│   │   │   ├── gallery/
│   │   │   ├── content/
│   │   │   ├── notifications/  # providers/brevo.js, templates/, jobs.js
│   │   │   ├── auth/
│   │   │   └── admin/
│   │   └── lib/              # utilitaires partagés (dates, tokens, errors)
│   ├── views/                # templates pages publiques et admin
│   └── client/
│       ├── styles/           # tokens.css, base.css, components/, pages/
│       ├── scripts/          # modules JS par composant / page
│       └── assets/
├── tests/e2e/
├── docker-compose.yml
└── .env.example
```

**Conventions** :
- Chaque module a un `README.md` de 10 lignes maximum : rôle, routes, tables, dépendances.
- Le métier est en fonctions pures, testables (ex. `availability.js` ne touche pas la base).
- Le SQL ne vit que dans `repo.js`. Les routes ne contiennent pas de logique métier.
- Nommage en anglais dans le code, contenu et interface en français. Commentaires en français autorisés pour le métier.
- Commits conventionnels (`feat:`, `fix:`…), une PR ou un commit par fonctionnalité.

## 12. Contenus et photos

- **Photos Instagram** (ancienne page « Glow in Locks » et nouveau compte) : ne **pas** les aspirer automatiquement (contraire aux conditions d'Instagram, et qualité médiocre). La propriétaire fournit ses photos d'origine (export depuis son téléphone ou téléchargement de ses données Instagram) dans `content/photos-a-importer/`. Un script les importe dans la galerie (redimensionnement, AVIF/WebP, suppression EXIF).
- En attendant : des **placeholders** élégants (dégradés karité / sable avec l'emblème en filigrane, ou blocs flous), clairement marqués. Pas de photos de banques d'images de personnes, qui rendent un site impersonnel.
- **Droit à l'image** : prévoir dans la fiche cliente une case « autorise la publication de photos ».
- **Instagram sur le site** : en v1, une grille de 6 à 9 photos choisies en admin, avec lien vers le profil. Un flux automatique (API Meta / Behold) est prévu en évolution.
- **Textes** : rédiger de vrais textes en français, chaleureux et experts, qui tutoient ou vouvoient de façon cohérente (**vouvoiement** par défaut). Pas de lorem ipsum. Marquer `<!-- TODO-PROPRIO -->` les infos à faire confirmer (adresse exacte, horaires, prix, nom de la fondatrice).

## 13. Sécurité (exigences non négociables)

- HTTPS partout, HSTS ; en-têtes via `@fastify/helmet` avec une **CSP stricte** (nonces, pas d'`unsafe-inline`).
- **Requêtes SQL toujours paramétrées.** Aucune concaténation de chaînes.
- Validation **côté serveur** de toutes les entrées (Zod). Échappement automatique dans les templates.
- **Auth admin** :
  - mots de passe hashés en **argon2id** ;
  - **2FA TOTP** obligatoire et codes de secours ;
  - sessions serveur en base, cookie `HttpOnly`, `Secure`, `SameSite=Lax` (Strict pour l'admin), rotation de l'ID à la connexion, expiration après inactivité ;
  - verrouillage progressif après des échecs.
- **CSRF** sur tous les formulaires (`@fastify/csrf-protection`).
- **Rate limiting** (`@fastify/rate-limit`) : login, réservation, formulaire de contact, avis. **Honeypot** et vérification anti-bot respectueuse de la vie privée (ex. Cloudflare Turnstile ou ALTCHA) sur les formulaires publics.
- Jetons des liens « gérer mon RDV » et « laisser un avis » : aléatoires, 32 octets ou plus, **stockés hashés**, à durée limitée.
- **Uploads** : vérification du type réel (magic bytes), taille max, ré-encodage par sharp (neutralise les fichiers piégés), noms aléatoires, stockage hors webroot ou sur S3 UE.
- Contrôle d'accès par rôle sur **chaque** route admin (tests à l'appui).
- Secrets uniquement via variables d'environnement, `.env` jamais commité, `.env.example` documenté.
- Logs sans données personnelles sensibles. Journal d'audit des actions admin.
- Dépendances : `npm audit` dans la CI, Dependabot ou Renovate.
- **Sauvegardes** quotidiennes chiffrées de la base, avec un test de restauration documenté.
- Revue finale selon l'OWASP Top 10 et une checklist dans `docs/SECURITY.md`.

## 14. RGPD et légal (France)

- Mentions légales, politique de confidentialité, politique de RDV / CGV.
- Analytics sans cookies, donc pas de bandeau. Si des cookies non essentiels s'ajoutent un jour, un bandeau conforme CNIL (refuser aussi simple qu'accepter).
- Consentements séparés : SMS transactionnels ≠ marketing. Newsletter en opt-in non coché.
- Droit d'accès et de suppression : export et suppression d'une cliente depuis l'admin.
- Durées de conservation : clientes inactives anonymisées après 3 ans (paramétrable).
- Données hébergées dans l'UE.

## 15. Design, animations et responsive

- Appliquer le skill **design-craft** et `brand/BRAND.md`.
- **Signatures d'animation** :
  1. le **fil de loc** SVG qui se dessine au scroll (`stroke-dashoffset` + ScrollTrigger) ;
  2. des titres révélés ligne par ligne (SplitText, masque) ;
  3. des images révélées par `clip-path` (arche qui s'ouvre) avec un léger parallax ;
  4. le carrousel horizontal des méthodes piloté par le scroll ;
  5. des transitions de page fluides (View Transitions API, fondu et glissement du titre) ;
  6. des boutons magnétiques subtils et un curseur personnalisé discret sur desktop uniquement ;
  7. un loader d'entrée très court (≤ 1,2 s, une seule fois par session) : le soleil terre cuite qui se lève, puis la silhouette qui apparaît.
- Courbes et durées selon design-craft. **`prefers-reduced-motion` respecté** : on désactive smooth scroll, parallax et fil animé (affiché statique).
- **Fully responsive** : à concevoir mobile-first et à tester à 360, 390, 768, 1024, 1280, 1440 et 1920 px. Menu mobile plein écran animé. Barre « Réserver » collante en bas sur mobile.
- **Navigation à la raissadora** : header sticky qui se rétracte au scroll vers le bas et réapparaît vers le haut, méga-menu « Prestations » sur desktop, tiroir sur mobile, bandeau d'annonce éditable, fil d'Ariane sur les pages profondes.

## 16. Performance, accessibilité, SEO

- **Budgets** :
  - Lighthouse ≥ 90 partout (≥ 95 en accessibilité et SEO) sur mobile ;
  - LCP < 2,5 s, CLS < 0,1, INP < 200 ms ;
  - JS initial < 120 ko gzip sur l'accueil (GSAP chargé à la demande).
- Images en AVIF/WebP avec `srcset`, `loading="lazy"` sauf le hero ; vidéo du hero < 2 Mo avec image poster.
- **WCAG 2.2 AA** : contrastes (cf. BRAND.md), navigation au clavier complète (tunnel de réservation compris), focus visibles, labels, `aria-live` pour les erreurs.
- **SEO** :
  - balises title et meta uniques, Open Graph avec visuels de marque ;
  - `sitemap.xml`, `robots.txt`, URLs propres en français ;
  - JSON-LD `HairSalon` (adresse, horaires, géo) et `Service` ;
  - page `/methodes` riche (contenu expert), contenus locaux (Toulouse, quartiers).
- Fiche Google Business Profile à relier (lien avis).

## 17. Phasage (ordre de réalisation)

| Phase | Contenu | Critère de fin |
|---|---|---|
| 0 | Mise en place : skill, repo, outillage, Docker, CLAUDE.md, docs | `npm run dev` fonctionne, lint et tests passent |
| 1 | Design system : tokens, typo, composants, page `/styleguide` | Styleguide validé visuellement (captures) |
| 2 | Pages publiques avec contenus seed (sans réservation) | Toutes les pages responsive, animations, Lighthouse OK |
| 3 | Base de données, API lecture (prestations, galerie, avis, contenus) | Pages alimentées par la base |
| 4 | Module de réservation (moteur + tunnel + gérer mon RDV) | Tests unitaires du moteur, e2e réservation |
| 5 | Notifications (Brevo, jobs, rappels, demande d'avis) + avis | Envois testés en mode sandbox |
| 6 | Admin complet (auth 2FA, agenda, CRUD, galerie, avis, réglages) | e2e admin, tests de contrôle d'accès |
| 7 | Durcissement : sécurité, RGPD, SEO, perf, a11y | Checklists `SECURITY.md` et a11y cochées |
| 8 | Déploiement + documentation d'exploitation | Site en ligne, sauvegardes testées |

## 18. Évolutions prévues (concevoir le code pour les accueillir)

- **Acompte en ligne** à la réservation (Stripe) contre les no-shows, ce qui compte pour des prestations de 4 à 9h.
- Cartes cadeaux, programme de fidélité.
- **Boutique** de produits pour locks (huiles, sprays).
- **Formations** (la référence twistsandlocks en propose) : inscriptions et paiement.
- Consultation en visio.
- Multi-praticiennes (déjà prévu en base).
- Site en anglais (i18n : textes dans des fichiers de traduction dès la v1).
- Flux Instagram automatique.
- PWA (installation sur le téléphone de la propriétaire pour l'admin, notifications push).
- Liste d'attente sur les créneaux complets.

## 19. Questions ouvertes pour la propriétaire

1. Nom et prénom de la fondatrice, adresse exacte du salon, horaires, téléphone, WhatsApp.
2. Prix et durées réels de chaque prestation et option.
3. Validation manuelle des RDV ou confirmation automatique ?
4. Délai d'annulation souhaité (48h par défaut) ? Acompte souhaité plus tard ?
5. Composition exacte de sa détox (pour la décrire justement).
6. Photos originales des réalisations, portrait professionnel, photos du salon, idéalement une vidéo de 10 s pour le hero.
7. Est-elle certifiée Sisterlocks™ ? Propose-t-elle des formations ?
8. Le salon twistsandlocks.com (Dakar) a-t-il un lien avec elle ? Il peut nourrir le récit.
9. Nouveau compte Instagram / nom de domaine souhaité (ex. latelierdeslocks.fr — vérifier disponibilité et marque INPI).
10. Accès Brevo (ou autre), nom de domaine, hébergement.
