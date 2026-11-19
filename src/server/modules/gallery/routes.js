// @ts-check
import { findGallery } from './repo.js';
import { filterGallery, galleryFacets } from './service.js';
import { galleryQuery } from './schemas.js';
import { findCatalog, findMethods } from '../services/repo.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function galleryRoutes(app) {
  app.get('/galerie', async (request, reply) => {
    const filters = galleryQuery.parse(request.query ?? {});
    const { items, sizes } = await findGallery(app.db);
    const { categories } = await findCatalog(app.db);
    const { methods } = await findMethods(app.db);
    return reply.page('pages/galerie', 'gallery', {
      title: 'Galerie des réalisations · L’Atelier des Locks, Toulouse',
      description:
        'Créations, resserrages, colorations et coiffures sur locks réalisées au salon, à Toulouse. Filtrez par prestation, méthode et taille de locks.',
      items,
      visibleIds: filterGallery(items, filters).map((i) => i.id),
      filters,
      facets: galleryFacets(items, categories, methods, sizes),
      categoryNames: Object.fromEntries(categories.map((c) => [c.slug, c.name])),
    });
  });

  // API de lecture publique : mêmes filtres que la page, valeurs invalides ignorées.
  app.get('/api/gallery', async (request) => {
    const filters = galleryQuery.parse(request.query ?? {});
    const { items } = await findGallery(app.db);
    return { items: filterGallery(items, filters) };
  });
}
