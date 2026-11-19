// @ts-check
/** Page d'accueil de l'espace pro : le tableau de bord. */
import { ANY } from '../admin/guard.js';
import { findBookingSettings } from '../booking/repo.js';
import { loadDashboard } from './service.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ now: () => Date }} options
 */
export default async function dashboardRoutes(app, { now }) {
  app.get('/', { config: { roles: ANY } }, async (request, reply) => {
    const principal = /** @type {NonNullable<typeof request.admin>} */ (request.admin);
    const settings = await findBookingSettings(app.db);
    const dashboard = await loadDashboard(app.db, {
      now: now(),
      timeZone: settings.timeZone,
      role: principal.user.role,
    });
    return reply.adminPage('admin/tableau-de-bord', {
      title: 'Aujourd’hui',
      section: 'dashboard',
      dashboard,
      isOwner: principal.user.role === 'owner',
    });
  });
}
