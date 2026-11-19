// @ts-check
/**
 * Cliente sans adresse email (rendez-vous pris par téléphone ou WhatsApp). La base exige un
 * email unique : on en fabrique un, stable pour un même numéro, sur un domaine réservé
 * (RFC 2606) qui ne reçoit jamais rien. Les notifications l'ignorent, et il n'est jamais affiché.
 */
export const PLACEHOLDER_DOMAIN = 'sans-email.invalid';

/** @param {string} phoneE164 @param {string} [salt]  pour un client sans téléphone ni email */
export const placeholderEmailFor = (phoneE164, salt = '') =>
  `tel-${phoneE164.replace(/\D/g, '') || salt}@${PLACEHOLDER_DOMAIN}`;

/** @param {string|null|undefined} email */
export const isPlaceholderEmail = (email) =>
  typeof email === 'string' && email.toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);

/** Email à montrer : rien si c'est un faux. @param {string|null|undefined} email */
export const displayEmail = (email) => (isPlaceholderEmail(email) ? null : (email ?? null));
