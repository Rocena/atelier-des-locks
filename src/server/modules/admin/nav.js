// @ts-check
/**
 * Navigation de l'administration, filtrée par rôle, et messages de confirmation.
 * Les messages passent par une clé (?ok=saved) : jamais de texte libre dans l'URL.
 */

/**
 * @typedef {object} NavItem
 * @property {string} href
 * @property {string} label
 * @property {string} icon  nom du symbole dans partials/admin-icons.eta
 * @property {readonly string[]} roles
 * @property {boolean} [tab]  affiché dans la barre du bas sur mobile
 */

/** @type {NavItem[]} */
export const NAV_ITEMS = [
  { href: '/admin', label: 'Aujourd’hui', icon: 'sun', roles: ['owner', 'staff'], tab: true },
  {
    href: '/admin/agenda',
    label: 'Agenda',
    icon: 'calendar',
    roles: ['owner', 'staff'],
    tab: true,
  },
  {
    href: '/admin/clientes',
    label: 'Clientes',
    icon: 'users',
    roles: ['owner', 'staff'],
    tab: true,
  },
  { href: '/admin/avis', label: 'Avis', icon: 'star', roles: ['owner', 'staff'] },
  { href: '/admin/galerie', label: 'Galerie', icon: 'image', roles: ['owner', 'staff'] },
  { href: '/admin/prestations', label: 'Prestations', icon: 'scissors', roles: ['owner'] },
  { href: '/admin/contenus', label: 'Contenus', icon: 'text', roles: ['owner'] },
  { href: '/admin/reglages', label: 'Réglages', icon: 'sliders', roles: ['owner'] },
  { href: '/admin/notifications', label: 'Messages envoyés', icon: 'mail', roles: ['owner'] },
  { href: '/admin/journal', label: 'Journal d’activité', icon: 'list', roles: ['owner'] },
  { href: '/admin/compte', label: 'Mon compte', icon: 'user', roles: ['owner', 'staff'] },
];

/**
 * @param {string} role
 * @param {string} pathname
 */
export function navigationFor(role, pathname) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role)).map((item) => ({
    ...item,
    current:
      item.href === '/admin'
        ? pathname === '/admin' || pathname === '/admin/'
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
  }));
}

/** Messages de confirmation (clé → texte). */
export const FLASH = /** @type {Record<string, string>} */ ({
  saved: 'Modifications enregistrées.',
  created: 'C’est créé.',
  deleted: 'C’est supprimé.',
  moved: 'Rendez-vous déplacé. La cliente est prévenue.',
  moved_silent: 'Rendez-vous déplacé.',
  status: 'Statut mis à jour.',
  blocked: 'Créneau bloqué.',
  unblocked: 'Blocage retiré.',
  anonymized: 'La cliente a été supprimée de vos fichiers.',
  password: 'Mot de passe modifié.',
  approved: 'Avis publié.',
  rejected: 'Avis refusé.',
  replied: 'Réponse enregistrée.',
  uploaded: 'Photos ajoutées.',
  reordered: 'Ordre enregistré.',
});

/**
 * Redirection après une action (POST → GET), avec message de confirmation.
 * @param {import('fastify').FastifyReply} reply
 * @param {string} url
 * @param {keyof typeof FLASH} key
 */
export function redirectWith(reply, url, key) {
  const separator = url.includes('?') ? '&' : '?';
  return reply.redirect(`${url}${separator}ok=${key}`, 303);
}
