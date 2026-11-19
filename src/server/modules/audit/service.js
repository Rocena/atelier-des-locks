// @ts-check
/**
 * Journal d'audit : qui a fait quoi (§13). Jamais de mot de passe, de code ni de secret dans
 * les détails. L'écriture ne doit jamais faire échouer l'action déjà accomplie : erreur journalisée.
 */
import * as repo from './repo.js';

/** Clés interdites dans les détails (filet de sécurité). */
const FORBIDDEN = /pass|secret|token|code|hash|totp/i;

/** @param {Record<string, unknown>} details */
export function cleanDetails(details) {
  return Object.fromEntries(Object.entries(details).filter(([key]) => !FORBIDDEN.test(key)));
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {string} action  ex. « service.update »
 * @param {{ type?: string, id?: string|number|null, details?: Record<string, unknown>, userId?: string|null }} [target]
 */
export async function audit(request, action, target = {}) {
  try {
    await repo.insertAudit(request.server.db, {
      userId: target.userId ?? request.admin?.user.id ?? null,
      action,
      entityType: target.type ?? null,
      entityId: target.id == null ? null : String(target.id),
      details: cleanDetails(target.details ?? {}),
      ip: request.ip,
    });
  } catch (error) {
    request.log.error({ err: error, action }, 'journal d’audit');
  }
}

/** Libellés lisibles des actions (affichage du journal). */
export const ACTION_LABELS = /** @type {Record<string, string>} */ ({
  'login.success': 'Connexion',
  'login.failure': 'Échec de connexion',
  'login.locked': 'Compte verrouillé',
  'login.recovery_code': 'Connexion avec un code de secours',
  logout: 'Déconnexion',
  'account.password': 'Mot de passe modifié',
  'account.recovery_codes': 'Codes de secours régénérés',
  'totp.enabled': 'Double authentification activée',
  'appointment.create': 'Rendez-vous créé',
  'appointment.move': 'Rendez-vous déplacé',
  'appointment.status': 'Statut modifié',
  'appointment.notes': 'Notes du rendez-vous modifiées',
  'block.create': 'Créneau bloqué',
  'block.delete': 'Blocage supprimé',
  'client.update': 'Fiche cliente modifiée',
  'client.export': 'Export des clientes',
  'client.anonymize': 'Cliente supprimée (RGPD)',
  'service.create': 'Prestation créée',
  'service.update': 'Prestation modifiée',
  'service.reorder': 'Ordre des prestations modifié',
  'category.update': 'Catégorie modifiée',
  'gallery.create': 'Photo ajoutée',
  'gallery.update': 'Photo modifiée',
  'gallery.delete': 'Photo supprimée',
  'review.approve': 'Avis approuvé',
  'review.reject': 'Avis refusé',
  'review.reply': 'Réponse à un avis',
  'review.feature': 'Avis mis en avant',
  'content.update': 'Contenu modifié',
  'article.update': 'Article modifié',
  'faq.update': 'FAQ modifiée',
  'settings.update': 'Réglages modifiés',
  'hours.update': 'Horaires modifiés',
  'closure.create': 'Fermeture ajoutée',
  'closure.delete': 'Fermeture supprimée',
});

/** @param {string} action */
export const actionLabel = (action) => ACTION_LABELS[action] ?? action;
