---
name: "design-craft"
description: "Use whenever building or restyling any web/app UI (pages, components, landing pages, dashboards) so the result looks premium, intentional and human, never generic AI output."
---

# Design Craft — UI/UX premium, stylé et humain

Synthèse des meilleurs skills design de 2026 (Anthropic frontend-design, Impeccable, taste-skill, Emil Kowalski design-eng, Vercel Web Interface Guidelines, UI/UX Pro Max). Objectif : une interface qu'on croirait faite par un très bon studio, pas par une IA.

## 1. Avant d'écrire une ligne de code

1. **Lire le contexte** : pour qui ? quel but de la page ? quelle émotion (confiance, énergie, calme, luxe, ludique) ? Si un design system / des tokens / une charte existent dans le projet, les utiliser en priorité.
2. **Choisir UNE direction esthétique et l'écrire en une phrase**, ancrée dans une référence réelle. Exemples : « éditorial type magazine, à la Stripe Press », « outil sobre et dense à la Linear », « chaleureux et artisanal à la Aesop », « brutaliste typographique », « doux et organique », « tech rétro-futuriste ». S'y tenir sur toute la page.
3. **Définir les tokens d'abord** (CSS variables / Tailwind theme) : couleurs, typo, échelle d'espacement, rayons, ombres, durées d'animation. Pas de valeurs magiques ensuite.
4. Une seule idée mémorable par page (une typo audacieuse, une mise en page asymétrique, une interaction signature). Le reste sert cette idée.

## 2. Typographie (50 % du rendu « classe »)

- Éviter Inter, Roboto, Arial, Open Sans, Space Grotesk et la police système **comme police de titre**. Préférer des polices à caractère : serif éditoriales (Fraunces, Instrument Serif, Newsreader, Playfair, GT Sectra-like), grotesques soignées (Geist, Satoshi, General Sans, Manrope, Switzer, Söhne-like), mono pour les accents techniques (JetBrains Mono, IBM Plex Mono).
- Maximum 2 familles (titre + texte), éventuellement une mono pour les données.
- Échelle modulaire (ratio 1.25 ou 1.333). Gros contraste de taille entre H1 et texte : un hero assume 56–96px en desktop.
- Texte courant 16–18px, interligne 1.5–1.65, longueur de ligne 60–75 caractères (`max-width: 65ch`).
- Titres : interligne serré (1.0–1.15) et letter-spacing légèrement négatif (-0.01 à -0.03em) sur les grandes tailles. Petites capitales / labels : +0.05 à +0.1em.
- Contraste de graisse franc (400 vs 600/700), pas 400 vs 500.
- Chiffres tabulaires (`font-variant-numeric: tabular-nums`) pour prix, stats, tableaux.
- `text-wrap: balance` sur les titres, `text-wrap: pretty` sur les paragraphes.
- Charger les fonts proprement (`font-display: swap`, preload des graisses utilisées seulement).

## 3. Couleur

- Travailler en **OKLCH** pour des palettes harmonieuses et des variations de luminosité prévisibles.
- **Neutres teintés** : jamais de gris pur ni de #000 / #fff bruts. Teinter légèrement les gris vers la couleur de marque (ou chaud/froid selon l'ambiance). Fond « blanc » = off-white (ex. oklch(98.5% 0.005 80)), texte « noir » = quasi-noir teinté.
- Règle 60-30-10 : neutres dominants, une couleur secondaire, **un seul accent** utilisé avec parcimonie (CTA principal, état actif, détail signature).
- Contraste WCAG AA minimum : 4.5:1 pour le texte, 3:1 pour gros texte et éléments d'UI. Le vérifier.
- Mode sombre ≠ inversion : fond pas totalement noir (ex. oklch(16% 0.01 260)), l'élévation se marque en éclaircissant les surfaces, accent légèrement désaturé, texte pas blanc pur.
- Couleurs sémantiques (succès/erreur/alerte) cohérentes avec la palette, jamais le rouge/vert saturé par défaut.

## 4. Mise en page et espacement

- Échelle d'espacement sur base 4/8 (4, 8, 12, 16, 24, 32, 48, 64, 96, 128). Rien hors échelle.
- **De l'air** : sections généreuses (96–160px verticaux en desktop). Le vide est un signe de luxe.
- Varier le rythme : pas toutes les sections centrées, pas toutes de la même hauteur. Alterner pleine largeur, colonnes asymétriques (7/5, 8/4), texte aligné à gauche, éléments qui débordent la grille.
- Hiérarchie claire par la taille, la graisse et l'espace avant la couleur.
- Proximité : l'espace entre éléments liés < espace entre groupes.
- Alignements rigoureux sur une grille ; un seul axe de lecture principal.
- Responsive pensé dès le début : tester 375, 768, 1280, 1536px. Typo fluide avec `clamp()`. Container queries pour les composants.

## 5. Détails qui font premium

- Bordures fines et subtiles (1px, faible contraste) plutôt que grosses ombres.
- Ombres en couches, douces et teintées (jamais `rgba(0,0,0,0.5)` dur).
- Échelle de rayons cohérente ; rayon intérieur = rayon extérieur − padding pour les éléments imbriqués.
- Icônes d'une seule famille, même épaisseur de trait (Lucide, Phosphor, Tabler). Jamais d'emoji en guise d'icônes.
- Images : vraie direction artistique (cadrage, traitement colorimétrique cohérent), ratios fixes, `object-fit: cover`. Grain/texture subtile en fond possible pour la chaleur.
- Focus visibles et soignés (`:focus-visible` avec outline offset, couleur d'accent).
- Sélection de texte, scrollbar, favicon, états vides : tout est stylé.

## 6. Mouvement (polish à la Emil Kowalski)

- Courbes : entrée = ease-out, transformation à l'écran = ease-in-out, hover = ease, mouvement continu = linear. Préférer des courbes custom (ex. `cubic-bezier(0.22, 1, 0.36, 1)`).
- Durées : micro-interactions 100–150ms, standard 150–250ms, modales/panneaux 200–300ms, sorties ~20 % plus rapides que les entrées. Rien au-dessus de 400ms pour l'UI.
- Apparitions : partir de `scale(0.95)` + opacité, jamais de `scale(0)`. Petits décalages (8–16px), pas de grands slides.
- Feedback de pression sur les boutons (`scale(0.97)` au :active).
- Animer seulement `transform` et `opacity`. Stagger léger (30–60ms) pour les listes.
- Pas de bounce gratuit, pas d'animation sur chaque élément au scroll. Le mouvement doit expliquer quelque chose.
- Toujours respecter `prefers-reduced-motion`.

## 7. UX et interaction

- Chaque composant interactif a tous ses états : default, hover, focus-visible, active, disabled, loading, empty, error, success.
- Zones cliquables ≥ 44×44px.
- Formulaires : labels visibles (pas seulement placeholder), validation inline au blur, messages d'erreur à côté du champ, bon `type`/`inputmode`/`autocomplete`, bouton désactivé seulement si l'utilisateur comprend pourquoi.
- Chargement : skeletons à la forme du contenu, UI optimiste quand c'est sûr, jamais de spinner plein écran si évitable.
- Navigation au clavier complète, ordre de tab logique, HTML sémantique (button, nav, main, h1-h6 dans l'ordre), `alt` utiles, aria seulement si nécessaire.
- Un CTA principal par vue ; les actions secondaires sont visuellement secondaires.
- Réduire la charge cognitive : progressive disclosure, valeurs par défaut intelligentes, pas plus de 5–7 choix visibles à la fois.
- Confirmation pour les actions destructrices, undo quand c'est possible.

## 8. Écriture UX — ce qui rend « humain »

- Jamais de lorem ipsum : écrire du contenu réaliste et spécifique au produit.
- Titres concrets qui disent la valeur, pas « Welcome to our platform » / « Bienvenue sur notre plateforme ».
- Boutons = verbe + objet (« Créer le projet », « Envoyer la facture »), pas « Valider » / « Submit » / « Click here ».
- Messages d'erreur : ce qui s'est passé + comment le corriger, sans jargon ni blâme.
- États vides : expliquer et proposer la première action.
- Ton cohérent avec la direction choisie ; une touche de personnalité dans les micro-textes, sans forcer.
- Ne pas répéter une info déjà visible.

## 9. Anti-patterns « IA slop » — à bannir

- Dégradé violet → bleu (ou violet sur blanc) par défaut ; texte en dégradé partout.
- Glassmorphism / blur de fond sans raison.
- Le hero centré « titre + sous-titre + 2 boutons » suivi de 3 cartes identiques avec icône dans un carré arrondi.
- Tout centré, toutes les sections identiques, `rounded-2xl` + `shadow-lg` sur tout.
- Stats génériques inventées (« 10k+ users », « 99.9% uptime ») et témoignages bidons.
- Emojis comme icônes, icônes ✨ sparkles, bordure colorée à gauche des cartes.
- Gris purs, noir pur sur blanc pur, accents multiples qui se battent.
- Ombres lourdes et sombres, néons gratuits, animations bounce/float partout.
- Polices par défaut (Inter/Roboto/Arial) en titre.
- Badges « New » / pills au-dessus de chaque titre.

Si le résultat ressemble à un template Tailwind UI moyen, recommencer la direction.

## 10. Contrôle final (obligatoire avant de livrer)

1. **Squint test** : en plissant les yeux, la hiérarchie est-elle évidente ? Un seul point focal par vue ?
2. Si un navigateur/screenshot est disponible : ouvrir la page et la REGARDER (desktop + mobile 375px), corriger ce qui cloche.
3. Contrastes vérifiés (AA), focus visibles, navigation clavier OK.
4. Tous les états présents (hover, loading, empty, error).
5. Aucun élément de la liste anti-patterns.
6. Toutes les valeurs viennent des tokens (pas de couleur ou d'espacement hors échelle).
7. Se demander : « Est-ce qu'un designer senior serait fier de signer ça ? Qu'est-ce qui rend cette page inoubliable ? » Si la réponse est « rien », ajouter la touche signature.