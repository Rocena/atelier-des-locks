// @ts-check
/**
 * Informations du salon affichées dans le header, le footer et le JSON-LD.
 * Phase 3 : ces valeurs viendront de la table des réglages (éditables en admin).
 * TODO-PROPRIO : adresse exacte, horaires, téléphone, WhatsApp, Instagram à confirmer.
 */
export const site = {
  name: "L'Atelier des Locks",
  tagline: 'Locticienne · Toulouse',
  city: 'Toulouse',
  // TODO-PROPRIO : adresse exacte (rue, quartier) et accès (métro, parking)
  address: { street: 'Adresse à confirmer', postalCode: '31000', city: 'Toulouse' },
  // TODO-PROPRIO : horaires réels
  hours: [
    { days: 'Mardi – vendredi', time: '9h30 – 19h' },
    { days: 'Samedi', time: '9h – 18h' },
    { days: 'Dimanche et lundi', time: 'Fermé' },
  ],
  /** Mêmes horaires, au format schema.org (1 = lundi). */
  openingHours: [
    { days: [2, 3, 4, 5], opens: '09:30', closes: '19:00' },
    { days: [6], opens: '09:00', closes: '18:00' },
  ],
  // TODO-PROPRIO : numéro et liens réels (téléphone au format +33…, lien wa.me, URL Instagram)
  phone: '',
  whatsapp: '',
  instagram: '',
  /** Navigation principale (desktop). « Prestations » ouvre le méga-menu. */
  nav: [
    { href: '/prestations', label: 'Prestations', mega: true },
    { href: '/methodes', label: 'Méthodes' },
    { href: '/galerie', label: 'Galerie' },
    { href: '/tarifs', label: 'Tarifs' },
    { href: '/le-salon', label: 'Le salon' },
    { href: '/contact', label: 'Contact' },
  ],
  /** Liens secondaires du tiroir mobile et du footer. */
  secondaryNav: [
    { href: '/avis', label: 'Avis clientes' },
    { href: '/conseils', label: 'Conseils' },
    { href: '/faq', label: 'Questions fréquentes' },
  ],
};
