// @ts-check
/**
 * Garde d'accès de l'administration (§13) : authentification puis rôle, sur CHAQUE route.
 *
 * - Chaque route déclare ses rôles : `config: { roles: OWNER }` ou `config: { roles: ANY }`.
 * - Une route sans rôle déclaré est refusée (403) : on ne peut pas « oublier » un contrôle.
 * - Les routes de connexion se déclarent `config: { access: 'public' }` ; celles de la 2FA
 *   `config: { access: 'half' }` (mot de passe vérifié, 2FA en attente).
 * - Pas de session valide → 401. Mauvais rôle → 403.
 */
import { authenticate } from '../auth/service.js';

export const OWNER = /** @type {const} */ (['owner']);
export const ANY = /** @type {const} */ (['owner', 'staff']);

/** Nom du cookie de session (préfixe __Host- en production : Secure, sans Domain, Path=/). */
export const sessionCookieName = (/** @type {boolean} */ isProd) =>
  isProd ? '__Host-adl_admin' : 'adl_admin';

/**
 * Hook onRoute : mémorise chaque route de l'admin et ses rôles (le test d'accès les parcourt).
 * @param {import('fastify').FastifyInstance} app
 * @param {Array<{ method: string, url: string, access: string, roles: readonly string[]|null }>} registry
 */
export function trackRoutes(app, registry) {
  app.addHook('onRoute', (route) => {
    const config = /** @type {any} */ (route.config ?? {});
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      registry.push({
        method,
        url: route.url,
        access: config.access ?? 'full',
        roles: config.roles ?? null,
      });
    }
  });
}

/**
 * Installe le contrôle d'accès dans le contexte courant (hook onRequest).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ cookieName: string, secret: string, now: () => Date }} options
 */
export function installGuard(app, { cookieName, secret, now }) {
  app.decorateRequest('admin', null);

  app.addHook('onRequest', async (request, reply) => {
    const config = /** @type {any} */ (request.routeOptions.config ?? {});
    const access = config.access ?? 'full';
    // Sessions lues pour toutes les routes (la page de connexion redirige si déjà connecté).
    const principal = await authenticate(
      { db: app.db, secret, now: now(), ip: request.ip, userAgent: request.headers['user-agent'] },
      request.cookies?.[cookieName],
    );
    request.admin = principal
      ? { user: principal.user, session: principal.session, half: !principal.session.mfaVerified }
      : null;

    if (access === 'public') return;

    if (!principal) return deny(request, reply, 401);
    if (access === 'half') {
      // Écrans de la 2FA : session à mi-chemin uniquement.
      if (principal.session.mfaVerified) return reply.redirect('/admin', 302);
      return;
    }
    // Accès complet : la 2FA doit être terminée.
    if (!principal.session.mfaVerified) return deny(request, reply, 401);

    // URL inconnue sous /admin : connectée, elle reçoit une 404 (pas un 403 trompeur).
    if (/** @type {any} */ (request).is404 === true) return;

    /** @type {readonly string[]|undefined} */
    const roles = config.roles;
    if (!roles || !roles.includes(principal.user.role)) return deny(request, reply, 403);
  });
}

/**
 * Réponse 401/403 : JSON pour les appels fetch, petite page HTML pour les navigations.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {401|403} status
 */
function deny(request, reply, status) {
  const wantsHtml = request.method === 'GET' && request.headers.accept?.includes('text/html');
  if (!wantsHtml) {
    return reply.code(status).send({
      error: status === 401 ? 'unauthenticated' : 'forbidden',
      message:
        status === 401 ? 'Connexion requise.' : 'Votre rôle ne donne pas accès à cette page.',
    });
  }
  return reply
    .code(status)
    .adminPage(status === 401 ? 'admin/connexion-requise' : 'admin/interdit', {
      title: status === 401 ? 'Connexion requise' : 'Accès réservé',
      bare: true,
      next: request.url,
    });
}
