# L'Atelier des Locks : identité visuelle

## Concept : « La lumière de l'atelier »

Le logo est une **évolution du logo d'origine** de Glow in Locks, comme le font les grandes maisons : on garde ce que les clientes reconnaissent et on le rend plus net, plus simple et plus premium.

**Ce qu'on garde (l'héritage)** : le **profil de femme, menton levé**, et son **chignon de locks**. C'est l'image que les clientes connaissent déjà.

**Ce qui évolue** :
- La silhouette est **redessinée en vecteur net** : beaucoup moins de détails, des sillons de locks réguliers, des contours propres.
- Un **soleil terre cuite** derrière la tête : c'est le « Glow » d'origine (la lumière) et le soleil de Dakar, devenus la chaleur de l'atelier toulousain.
- Un **liseré karité** autour de la silhouette, la touche « médaille » des maisons de couture. Il garantit aussi la lisibilité sur tous les fonds.
- **Le nom** est en Bodoni Moda, avec *des* en italique terre cuite et l'**apostrophe en mini-loc**.

**Règles de design graphique appliquées :**
- **Reconnaissable en un clin d'œil** : un profil fier sur un soleil. Deux formes, une couleur d'accent.
- **Continuité** : les anciennes clientes reconnaissent la silhouette malgré le nouveau nom.
- **Système déclinable** :
  - l'emblème complet pour l'enseigne et le hero ;
  - la version horizontale pour l'en-tête du site ;
  - une **silhouette pleine simplifiée** pour le favicon et l'avatar, lisible jusqu'à 16 px.
- **Monochrome possible** (tampon, gravure, broderie) avec `emblème-monochrome.svg`.

## Fichiers

| Fichier | Usage |
|---|---|
| `logo-vertical.svg` / `logo-vertical-sombre.svg` | Enseigne, hero du site, cartes de visite, flyers |
| `logo-horizontal.svg` / `logo-horizontal-sombre.svg` | En-tête du site, footer, signatures email |
| `emblème.svg` | Le symbole seul (silhouette + soleil) : page « Le salon », réseaux, packaging |
| `emblème-monochrome.svg` | Sans soleil, pour impression une couleur, tampon, broderie |
| `logotype.svg` | Le nom seul, quand l'emblème est déjà présent ailleurs |
| `favicon.svg` | Favicon et icône d'app (silhouette pleine, lisible en 16–32 px) |
| `avatar-reseaux.svg` | Photo de profil Instagram, Google, WhatsApp (format rond) |

Le texte est vectorisé : aucune police n'est nécessaire pour afficher les logos.
**Zone de protection** autour du logo : la hauteur du « L ». **Taille minimale** : 140 px de large pour le logo horizontal, 48 px pour l'emblème. En dessous, utiliser le favicon.

**À ne pas faire** : déformer le logo, retirer le liseré karité sur un fond foncé, changer les couleurs hors palette, ajouter une ombre ou un dégradé, poser le logo sur une photo chargée sans voile.

## Palette

| Token | Nom | Hex | Usage |
|---|---|---|---|
| `--color-ebene` | Ébène | `#1C1310` | Texte principal, sections sombres |
| `--color-cacao` | Cacao | `#3A2A22` | Texte secondaire, surfaces sombres élevées |
| `--color-terre` | Terre cuite | `#A9472E` | **L'accent unique** : CTA, liens, mots en italique, symbole |
| `--color-laiton` | Laiton | `#B8914A` | Filets fins, détails précieux. **Décoratif**, ou texte sur fond sombre seulement |
| `--color-lin` | Lin | `#E6D6C1` | Surfaces alternées, bordures, cartes |
| `--color-karite` | Karité | `#F4ECE2` | Fond principal (jamais de blanc pur) |

**Contrastes vérifiés (WCAG)** :

| Combinaison | Ratio | Niveau |
|---|---|---|
| Ébène sur karité | 15.6:1 | AAA |
| Terre cuite sur karité (et karité sur terre cuite) | 4.95:1 | AA, texte et boutons OK |
| Laiton sur ébène | 6.25:1 | AA |
| Laiton sur karité | 2.5:1 | ❌ jamais pour du texte |

**Proportions** : environ 70 % karité et lin, 20 % ébène et cacao, 8 % terre cuite, 2 % laiton.
Une seule couleur d'accent (la terre cuite) : c'est ce qui rend la marque reconnaissable.
Le CSS utilise des tokens en OKLCH. Les neutres sont teintés chaud.
Mode sombre : fond ébène, texte karité. L'emblème garde son soleil terre cuite et son liseré karité.

## Typographie

| Rôle | Police | Source | Réglages |
|---|---|---|---|
| Titres / display | **Bodoni Moda** 500 + *400 italic* | Google Fonts / `@fontsource-variable/bodoni-moda` (OFL) | Utiliser l'axe optique `opsz` élevé pour les grands titres. Interligne 1.0–1.1, letter-spacing -0.01em, tailles 40–128px |
| Texte et UI | **Manrope** 400 / 500 / 600 | Google Fonts / `@fontsource-variable/manrope` (OFL) | 16–18px, interligne 1.6 |

- **La signature** : un mot en *italique Bodoni terre cuite* dans chaque grand titre. Par exemple « Vos locks, *un art*. », « L'art de la *loc*, à Toulouse. », « Prenez soin de *vos racines*. »
- Surtitres et labels : Manrope 500, MAJUSCULES, letter-spacing +0.2em, 12–13px.
- Les chiffres (prix, durées) sont en tabulaires (Manrope).
- Polices auto-hébergées (RGPD), préchargement de Bodoni 500 et Manrope 400.

## Ton de voix

Expert, chaleureux, fier. On **vouvoie**. Les phrases sont courtes. On parle de **savoir-faire, de patience, de soin et de racines**. Pas de jargon sans explication.
Accroche : **« L'art de la loc, à Toulouse. »**

## Motifs et textures

- **Le fil de loc** : une ligne SVG striée, comme une loc, qui se dessine au scroll et relie les sections. C'est l'élément signature du site.
- **Le soleil** : des disques terre cuite en fond de certaines sections et derrière les portraits (rappel de l'emblème). Ils peuvent grandir légèrement au scroll.
- **Les arches** : cadres des portraits et des photos de réalisations. Elles s'ouvrent à l'apparition (clip-path).
- **Le filet laiton** : séparateurs fins (1px) et soulignés d'accent.
- **Grain papier** : 3–5 % sur les fonds karité.
- **Trame bogolan** : losanges et lignes en lin sur karité ou en cacao sur ébène, très discrète, en filigrane de quelques sections.

## Direction photo

- Lumière naturelle et chaude, peaux sublimées, fonds neutres (lin, brique, bois).
- Gros plans de texture, mains de la locticienne au travail (le geste de l'artisane), portraits de 3/4, avant/après.
- Traitement homogène : chaud, noirs profonds, sans filtres.
- Toujours avec l'accord écrit des clientes (droit à l'image).
