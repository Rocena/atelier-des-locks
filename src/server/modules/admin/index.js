// @ts-check
/**
 * Coque de l'administration (§9) : tout ce qui est sous /admin.
 * - contrôle d'accès par rôle sur chaque route (guard.js) ;
 * - en-têtes privés (jamais en cache, jamais indexé) ;
 * - rendu des pages (`reply.adminPage`) avec le layout sobre, la navigation et le jeton CSRF ;
 * - enregistrement des modules métier qui exposent des routes admin.
 * Aucune logique métier ici.
 */
import { site } from '../../lib/site.js';
import { fmt } from '../../lib/format.js';
import { admin as adminFormat } from './format.js';
import { ANY, OWNER, installGuard, trackRoutes } from './guard.js';
import { FLASH, navigationFor } from './nav.js';
import authRoutes from '../auth/routes.js';
import dashboardRoutes from '../dashboard/routes.js';
import agendaRoutes from '../agenda/routes.js';
import clientsRoutes from '../clients/routes.js';
import servicesAdminRoutes from '../services/admin-routes.js';
import galleryAdminRoutes from '../gallery/admin-routes.js';
import reviewsAdminRoutes from '../reviews/admin-routes.js';
import contentAdminRoutes from '../content/admin-routes.js';
import settingsRoutes from '../settings/routes.js';
import auditRoutes from '../audit/routes.js';

export { ANY, OWNER };

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ config: import('../../config.js').AppConfig, now?: () => Date, views: { render: (t: string, d: Record<string, unknown>) => string, assets: (name: any) => any } }} options
 */
export default async function adminShell(app, { config, now = () => new Date(), views }) {
  const cookieName = app.adminCookie;
  trackRoutes(app, app.adminRoutes);

  // Pages d'erreur et rendu : décorateur de réponse propre à l'admin.
  app.decorateReply(
    'adminPage',
    /** @this {import('fastify').FastifyReply} */
    function adminPage(template, data = {}) {
      const request = this.request;
      const principal = request.admin;
      const csrf = this.generateCsrf();
      const pathname = request.url.split('?')[0];
      const query = /** @type {Record<string, string>} */ (request.query ?? {});
      const html = views.render(template, {
        nonce: this.cspNonce?.script ?? '',
        assets: views.assets('admin'),
        csrf,
        user: principal?.user ?? null,
        half: principal?.half ?? false,
        nav: principal && !principal.half ? navigationFor(principal.user.role, pathname) : [],
        pathname,
        flash: typeof query.ok === 'string' ? (FLASH[query.ok] ?? null) : null,
        fmt,
        a: adminFormat,
        site,
        publicUrl: config.publicUrl,
        errors: {},
        values: {},
        bare: false,
        ...data,
      });
      return this.type('text/html; charset=utf-8').send(html);
    },
  );

  // Réponses privées : jamais en cache ni indexées, jamais de Referer vers l'extérieur.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  installGuard(app, { cookieName, secret: config.sessionSecret, now });

  const ctx = { config, now };
  await app.register(authRoutes, ctx);
  await app.register(dashboardRoutes, ctx);
  await app.register(agendaRoutes, ctx);
  await app.register(clientsRoutes, ctx);
  await app.register(servicesAdminRoutes, ctx);
  await app.register(galleryAdminRoutes, ctx);
  await app.register(reviewsAdminRoutes, ctx);
  await app.register(contentAdminRoutes, ctx);
  await app.register(settingsRoutes, ctx);
  await app.register(auditRoutes, ctx);

  // Page « Plus » (mobile) : toutes les rubriques accessibles au rôle.
  app.get('/plus', { config: { roles: ANY } }, async (request, reply) =>
    reply.adminPage('admin/plus', { title: 'Plus', section: 'plus' }),
  );

  // Toute URL inconnue sous /admin : 404 discrète (la garde a déjà filtré les non connectés).
  app.setNotFoundHandler((request, reply) => {
    reply.code(404);
    if (request.headers.accept?.includes('text/html')) {
      return reply.adminPage('admin/introuvable', { title: 'Page introuvable' });
    }
    return { error: 'Not Found' };
  });
}
