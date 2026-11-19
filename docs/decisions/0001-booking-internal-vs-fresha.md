# ADR 0001 : module de réservation interne plutôt que Fresha

- **Statut** : acceptée
- **Date** : 2026-11-19
- **Référence** : cahier des charges §7.1

## Contexte

La fondatrice gère aujourd'hui ses rendez-vous sur **Fresha**. Le site doit permettre de réserver en moins de 2 minutes sur mobile, dans une expérience fidèle à la marque (§2).

Constats :

- Fresha **n'offre pas d'API publique** pour les salons. Il est impossible de lire ou d'écrire dans son agenda depuis notre code.
- Fresha propose seulement un **lien de réservation** (« Link builder », qui exige un profil listé sur sa marketplace) ou un **widget** dont le design ne se personnalise pas.
- Il n'y a donc **aucune synchronisation automatique** possible entre Fresha et un autre agenda.

## Décision

Nous construisons **notre propre module de réservation**, qui devient la **source de vérité** des rendez-vous. Il passe par un **adaptateur** choisi par variable d'environnement :

```
BOOKING_PROVIDER=internal       # notre module (par défaut)
BOOKING_PROVIDER=fresha_link    # les boutons « Réserver » ouvrent FRESHA_BOOKING_URL
```

La configuration (`src/server/config.js`) refuse `fresha_link` sans `FRESHA_BOOKING_URL`.

## Conséquences

- **Positives** : tunnel de réservation aux couleurs de la marque, données hébergées dans l'UE et maîtrisées (RGPD), règles métier sur mesure (prestations de 4 à 9 h, tampons, options, multi-praticiennes prêt), avis vérifiés reliés aux RDV terminés, rappels email et SMS.
- **Négatives** : nous devons développer et maintenir le moteur de disponibilités, les notifications et l'agenda admin (phases 4 à 6).
- **Transition** : quand le module interne passe en production, la propriétaire désactive la prise de RDV en ligne sur Fresha (ou bloque son agenda Fresha) pour éviter les doubles réservations. Le module expose un **flux iCal privé** (URL secrète) à ajouter à son téléphone ou à Google Agenda.
- **Repli** : en cas de problème, basculer `BOOKING_PROVIDER=fresha_link` redirige tous les boutons « Réserver » vers Fresha, sans redéploiement de code.
