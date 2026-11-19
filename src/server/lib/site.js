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
  // TODO-PROPRIO : adresse exacte
  address: { street: 'Adresse à confirmer', postalCode: '31000', city: 'Toulouse' },
  // TODO-PROPRIO : horaires réels
  hours: [
    { days: 'Mardi – vendredi', time: '9h30 – 19h' },
    { days: 'Samedi', time: '9h – 18h' },
    { days: 'Dimanche et lundi', time: 'Fermé' },
  ],
  // TODO-PROPRIO : numéro et liens réels
  phone: '',
  whatsapp: '',
  instagram: '',
  nav: [
    { href: '/prestations', label: 'Prestations' },
    { href: '/methodes', label: 'Méthodes' },
    { href: '/galerie', label: 'Galerie' },
    { href: '/tarifs', label: 'Tarifs' },
    { href: '/le-salon', label: 'Le salon' },
    { href: '/contact', label: 'Contact' },
  ],
};
