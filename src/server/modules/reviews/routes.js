// @ts-check
import { findPublishedReviews } from './repo.js';
import { sortByDate, summarizeReviews } from './service.js';
import { findCatalog } from '../catalog/repo.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function reviewsRoutes(app) {
  app.get('/avis', async (_request, reply) => {
    const reviews = await findPublishedReviews();
    const { services } = await findCatalog();
    return reply.page('pages/avis', 'editorial', {
      title: 'Avis clientes · L’Atelier des Locks, Toulouse',
      description:
        'Les avis vérifiés des clientes de L’Atelier des Locks, laissés après leur rendez-vous : création, resserrage, détox, coloration et coiffure sur locks.',
      reviews: sortByDate(reviews),
      summary: summarizeReviews(reviews),
      serviceNames: Object.fromEntries(services.map((s) => [s.slug, s.name])),
    });
  });
}
