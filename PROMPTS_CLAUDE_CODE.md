# Kit L'Atelier des Locks : mode d'emploi + prompts Claude Code

## Pourquoi un prompt court + un cahier des charges

Un seul prompt géant serait relu en entier à chaque échange. Il consommerait beaucoup de tokens et se ferait « oublier » quand la conversation s'allonge. On fait donc l'inverse :

* **le cahier des charges** (`docs/CAHIER\_DES\_CHARGES.md`) vit dans le projet, et Claude Code n'en lit que la section utile à chaque phase ;
* **des prompts courts, un par phase** : on lance une phase, on la termine, on fait `/clear`, puis on lance la suivante ;
* **`docs/PROGRESS.md`** sert de mémoire entre les sessions. Claude y note ce qui est fait et ce qui reste ;
* **`CLAUDE.md`** reste très court (règles + liens), parce qu'il est chargé à chaque session.

## Installation (une seule fois)

1. Crée un dossier vide, par exemple `atelier-des-locks`, et dézippe-y le kit. Tu dois avoir :

```
   atelier-des-locks/
   ├── PROMPTS\_CLAUDE\_CODE.md   (ce fichier)
   ├── docs/CAHIER\_DES\_CHARGES.md
   ├── brand/  (logos SVG + BRAND.md)
   └── .claude/skills/design-craft/SKILL.md
   ```

   ⚠️ Le dossier `.claude` est caché. Sur Mac, fais `Cmd+Maj+.` dans le Finder pour l'afficher.

2. Installe **Node.js LTS** et **Docker Desktop** (pour PostgreSQL).
3. Dans un terminal : `cd atelier-des-locks`, puis `git init`, puis `claude`.

## Bonnes pratiques pour économiser les tokens

* **Une phase = une session.** À la fin de chaque phase : vérifie, fais un commit (Claude le fait), puis tape `/clear`.
* **Mode plan** (`Shift+Tab` jusqu'à « plan mode ») au début des phases 0, 4 et 6. Claude propose un plan, tu valides, il code. Cela évite les allers-retours coûteux.
* `/compact` si une session devient longue au milieu d'une phase.
* `/model` : un modèle Opus pour le design, l'architecture et le moteur de réservation (phases 0, 1, 2, 4) ; un modèle Sonnet suffit pour le CRUD admin, la doc et les corrections (phases 3, 5, 6, 7).
* Ne colle pas de gros fichiers dans le chat. Donne le chemin, Claude ira lire.
* Pour un retour sur le design, donne une **capture d'écran** (glisser-déposer dans le terminal) plutôt qu'une longue description.

\---

## PROMPT 1 : Phase 0 (fondations) + Phase 1 (design system)

> Copie-colle tout le bloc ci-dessous dans Claude Code, en \*\*mode plan\*\*.

```
Tu vas construire le site et la plateforme du salon "L'Atelier des Locks" (locticienne, cheveux afro, femmes, Toulouse).

ÉTAPE 0 : Skill design
- Vérifie que .claude/skills/design-craft/SKILL.md existe dans le projet. Sinon, copie \~/.claude/skills/design-craft/SKILL.md vers .claude/skills/design-craft/SKILL.md.
- Lis ce skill : il s'applique à TOUT le front-end du projet.

SOURCES DE VÉRITÉ (lis-les avant de planifier)
- docs/CAHIER\_DES\_CHARGES.md : lis en entier une seule fois maintenant. Ensuite, ne relis que les sections nécessaires.
- brand/BRAND.md + les SVG de brand/ : identité visuelle à respecter strictement.

TA MISSION DANS CETTE SESSION : Phases 0 et 1 du §17.
Phase 0 :
1. Initialise le projet selon §10 (stack) et §11 (arborescence) : Node LTS, Fastify, Vite multi-pages, PostgreSQL via docker-compose, ESLint/Prettier, Vitest, Playwright, jsconfig checkJs, .env.example, scripts npm (dev, build, test, lint, db:migrate, db:seed).
2. Crée CLAUDE.md (≤ 60 lignes) : résumé du projet, commandes, conventions §11, règles de sécurité §13 en 10 puces, "toujours lire docs/PROGRESS.md en début de session et le mettre à jour en fin de phase", lien vers le cahier des charges et le skill design-craft. Crée AGENTS.md qui renvoie vers CLAUDE.md.
3. Crée docs/ARCHITECTURE.md, docs/SECURITY.md (checklist), docs/PROGRESS.md, docs/decisions/0001-booking-internal-vs-fresha.md (reprends la décision du §7.1).
Phase 1 :
4. Design system dans src/client/styles/ : tokens.css (palette BRAND.md convertie en OKLCH, échelle typo fluide avec clamp, espacements, rayons, ombres, durées et courbes d'animation), polices auto-hébergées (@fontsource-variable Bodoni Moda + Manrope, cf. BRAND.md), base.css, composants (boutons, liens, cartes prestation, badge, champ de formulaire, header sticky, menu mobile plein écran, footer, arche photo, fil de loc SVG, grain, motif bogolan).
5. Une page /styleguide qui montre tous les tokens et composants, avec leurs états (hover, focus, disabled, erreur), en clair et en sombre.
6. Lance le serveur, prends des captures du styleguide (desktop 1440 et mobile 390) si tu as un navigateur à disposition. Critique-les avec la checklist §10 de design-craft, puis corrige.

RÈGLES
- Pas de lorem ipsum : vrais textes en français (vouvoiement), marqués <!-- TODO-PROPRIO --> si une info doit être confirmée.
- Ne télécharge AUCUNE photo depuis Instagram ni depuis le web. Utilise des placeholders de marque (cf. §12).
- Commits conventionnels à chaque étape logique.
- Fin de session : mets à jour docs/PROGRESS.md (fait / reste / décisions / questions pour la propriétaire), fais un commit, puis résume en 10 lignes maximum.

Commence par me présenter ton plan.
```

\---

## PROMPT 2 : Phase 2 (pages publiques)

```
Lis CLAUDE.md et docs/PROGRESS.md. Puis lis dans docs/CAHIER\_DES\_CHARGES.md uniquement les §3, §5, §6, §12, §15 et §16.
Applique le skill design-craft et brand/BRAND.md.

Mission : Phase 2. Construis toutes les pages publiques du §5 (sauf réservation fonctionnelle, admin et pages à jeton) avec des données seed en JSON temporaire dans src/server/db/seeds/ (elles migreront en base en phase 3).
- Accueil exactement selon le déroulé du §5, avec les 7 signatures d'animation du §15 (GSAP + ScrollTrigger + SplitText chargés à la demande, Lenis, View Transitions).
- Navigation à la raissadora (§15), barre "Réserver" collante sur mobile.
- Pages prestations et méthodes : contenu expert, pédagogique et chaleureux (§6).
- prefers-reduced-motion respecté partout.
Vérifie chaque page à 390, 768 et 1440 px (captures si possible). Lance Lighthouse mobile si possible et respecte les budgets du §16.
Fin : PROGRESS.md, commit, résumé court.
```

## PROMPT 3 : Phase 3 (base de données + API de lecture)

```
Lis CLAUDE.md et docs/PROGRESS.md, puis les §6, §7.3, §8, §10 et §11 du cahier des charges.
Mission : Phase 3. Conçois le schéma PostgreSQL complet pour TOUTES les phases (services, categories, methods, options, staff, opening\_hours, closures, blocks, clients, appointments avec contrainte EXCLUDE anti-chevauchement, reviews, review\_tokens, gallery\_items, tags, content\_blocks, settings, notifications\_log, users, sessions, audit\_log), en migrations SQL numérotées et commentées. Documente-le dans docs/DATABASE.md.
Migre les seeds JSON vers la base (prix marqués is\_placeholder = true). Crée les modules services, gallery, reviews (lecture) et content : routes, service, repo (SQL paramétré), schémas zod, README, tests. Branche les pages publiques dessus.
Fin : PROGRESS.md, commit, résumé court.
```

## PROMPT 4 : Phase 4 (réservation) — en mode plan

```
Lis CLAUDE.md et docs/PROGRESS.md, puis les §7 et §13 du cahier des charges.
Mission : Phase 4, le module de réservation interne avec adaptateur BOOKING\_PROVIDER (internal | fresha\_link).
1. D'abord availability.js : moteur pur (horaires, exceptions, blocages, durées longues, tampons, délai minimum, horizon, Europe/Paris + changement d'heure, multi-staff). Écris d'abord des tests Vitest exhaustifs (TDD), puis l'implémentation.
2. API : créneaux disponibles, création de RDV (transaction + contrainte d'exclusion, rate limit, anti-bot, CSRF), gérer mon RDV par jeton hashé (voir, déplacer, annuler selon la politique), .ics, flux iCal privé.
3. Tunnel /reserver en 4 étapes (§7.2), mobile-first, accessible au clavier, avec états de chargement, erreurs et vide. Upload photo cheveux sécurisé (§13).
4. Tests e2e Playwright du parcours complet sur mobile et desktop.
Présente ton plan avant de coder. Fin : PROGRESS.md, commit, résumé court.
```

## PROMPT 5 : Phase 5 (notifications + avis)

```
Lis CLAUDE.md et docs/PROGRESS.md, puis les §7.6 et §8 du cahier des charges.
Mission : Phase 5. Module notifications avec interface NotificationProvider, implémentation Brevo (email + SMS) et un provider "console" pour le dev et les tests. Jobs pg-boss : confirmation, rappels J-2 (email) et J-1 18h (SMS), notification propriétaire, demande d'avis 3h après le statut "terminé", une relance à J+5. Modèles d'emails HTML responsive aux couleurs de la marque (logo, palette, typos de secours).
Module avis : lien à jeton unique, formulaire /avis/laisser/\[token], photo optionnelle, consentement, statut "à modérer", affichage public des avis approuvés, note moyenne, lien vers les avis Google.
Tests unitaires de la planification des jobs. Fin : PROGRESS.md, commit, résumé court.
```

## PROMPT 6 : Phase 6 (admin) — en mode plan

```
Lis CLAUDE.md et docs/PROGRESS.md, puis les §9 et §13 du cahier des charges. Applique design-craft (version plus sobre, mobile-first : la propriétaire l'utilise sur son téléphone).
Mission : Phase 6, le back-office complet.
1. Auth : argon2id, 2FA TOTP obligatoire + codes de secours, sessions en base, verrouillage progressif, rôles (owner, staff). Script CLI pour créer le premier compte owner.
2. Tableau de bord, agenda (jour, semaine, liste, glisser-déposer avec notification à la cliente, RDV manuel, blocages), clientes (historique, notes, export CSV, suppression RGPD), prestations et tarifs (CRUD + ordre), galerie (upload multiple, recadrage, tags, alt obligatoire), avis (modération, réponse), contenus, réglages, journal d'audit, journal des notifications.
3. Tests : contrôle d'accès sur CHAQUE route admin (non connecté → 401, staff → 403 sur ce qui est réservé à l'owner), e2e des parcours principaux.
Présente ton plan avant de coder. Fin : PROGRESS.md, commit, résumé court.
```

## PROMPT 7 : Phase 7 (durcissement + qualité)

```
Lis CLAUDE.md, docs/PROGRESS.md et docs/SECURITY.md, puis les §13, §14 et §16 du cahier des charges.
Mission : Phase 7.
1. Lance un sous-agent "auditeur sécurité" indépendant. Il relit le code selon l'OWASP Top 10 et la checklist SECURITY.md, puis rapporte les problèmes sans les corriger. Ensuite, corrige ses constats.
2. Vérifie CSP stricte, en-têtes, rate limits, uploads, jetons, sessions. Lance npm audit.
3. RGPD : pages légales (marquées TODO-PROPRIO pour les infos légales), consentements, export et suppression, durées de conservation.
4. SEO : meta, OG, sitemap, robots, JSON-LD HairSalon + Service.
5. Accessibilité WCAG 2.2 AA et performance (budgets du §16) : audite, corrige, et note les scores dans PROGRESS.md.
Fin : PROGRESS.md, commit, résumé court.
```

## PROMPT 8 : Phase 8 (déploiement)

```
Lis CLAUDE.md et docs/PROGRESS.md, puis les §10 et §13 du cahier des charges.
Mission : Phase 8. Prépare le déploiement en production dans l'UE : Dockerfile multi-stage, docker-compose.prod.yml (app, Postgres, Caddy pour HTTPS), sauvegardes quotidiennes chiffrées avec un script de restauration testé, healthcheck, logs. Rédige docs/DEPLOIEMENT.md pas à pas, pour une personne non technique, et docs/GUIDE\_PROPRIETAIRE.md (comment utiliser l'admin, avec captures). Liste ce dont j'ai besoin de mon côté : domaine, VPS, clés Brevo, etc.
Ne déploie rien sans ma confirmation explicite.
```

\---

## Prompts utiles en cours de route

* **Retouche design** : « Voici une capture de \[page]. Applique design-craft : identifie les 5 faiblesses visuelles principales et corrige-les. Ne touche à rien d'autre. »
* **Nouvelle fonctionnalité plus tard** : « Lis CLAUDE.md, PROGRESS.md et le §18. Je veux ajouter \[X]. Écris d'abord un ADR dans docs/decisions/, puis propose un plan. »
* **Reprise après une pause** : « Lis CLAUDE.md et docs/PROGRESS.md. Dis-moi où on en est et quelle est la prochaine étape. »

