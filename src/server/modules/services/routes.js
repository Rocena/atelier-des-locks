// @ts-check
/**
 * Pages du catalogue : /prestations, /prestations/:slug, /methodes, /tarifs.
 */
import { findCatalog, findMethods } from './repo.js';
import {
  findActiveService,
  groupByCategory,
  methodsByFamily,
  methodsOf,
  relatedServices,
  serviceJsonLd,
} from './service.js';
import { publicService, slugParams, servicesQuery } from './schemas.js';
import { site } from '../../lib/site.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function catalogRoutes(app) {
  app.get('/prestations', async (_request, reply) => {
    const { categories, services } = await findCatalog(app.db);
    return reply.page('pages/prestations', 'services', {
      title: 'Prestations · L’Atelier des Locks, locticienne à Toulouse',
      description:
        'Création de locks, resserrage, détox, coloration et coiffure sur locks à Toulouse. Durées, prix et méthodes expliqués simplement.',
      ...groupByCategory(categories, services),
    });
  });

  app.get('/prestations/:slug', async (request, reply) => {
    const parsed = slugParams.safeParse(request.params);
    if (!parsed.success) return reply.callNotFound();
    const { categories, services } = await findCatalog(app.db);
    const service = findActiveService(services, parsed.data.slug);
    if (!service) return reply.callNotFound();
    const { methods } = await findMethods(app.db);
    const category = categories.find((c) => c.slug === service.category) ?? null;
    return reply.page('pages/prestation', 'services', {
      title: `${service.name} à Toulouse · L’Atelier des Locks`,
      description: service.summary,
      service,
      category,
      methods: methodsOf(service, methods),
      related: relatedServices(services, service),
      categoryNames: Object.fromEntries(categories.map((c) => [c.slug, c.name])),
      breadcrumb: [
        { label: 'Accueil', href: '/' },
        { label: 'Prestations', href: '/prestations' },
        ...(category ? [{ label: category.name, href: `/prestations#${category.slug}` }] : []),
        { label: service.name, href: `/prestations/${service.slug}` },
      ],
      jsonLd: [serviceJsonLd(service, site, app.publicUrl)],
    });
  });

  app.get('/methodes', async (_request, reply) => {
    const { methods, stages } = await findMethods(app.db);
    return reply.page('pages/methodes', 'methods', {
      title: 'Les méthodes de locks expliquées · L’Atelier des Locks, Toulouse',
      description:
        'Comb coils, vanilles, tresses, interlocking, crochet, micro-locks, palm rolling : le guide des méthodes de création et d’entretien des locks, par une locticienne toulousaine.',
      methods,
      stages,
      families: methodsByFamily(methods),
    });
  });

  app.get('/tarifs', async (_request, reply) => {
    const { categories, services } = await findCatalog(app.db);
    return reply.page('pages/tarifs', 'services', {
      title: 'Tarifs · L’Atelier des Locks, locticienne à Toulouse',
      description:
        'Grille tarifaire complète : création de locks, resserrage, détox, coloration, coiffure et options. Prix et durées indicatifs.',
      ...groupByCategory(categories, services),
    });
  });

  // API de lecture publique (JSON). Jamais d'info interne : isPlaceholder reste côté admin (§6).
  app.get('/api/services', async (request) => {
    const { categorie } = servicesQuery.parse(request.query ?? {});
    const { services } = await findCatalog(app.db);
    return {
      services: services
        .filter((s) => s.active && (!categorie || s.category === categorie))
        .map(publicService),
    };
  });

  app.get('/api/services/:slug', async (request, reply) => {
    const parsed = slugParams.safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: 'Not Found' });
    const { services } = await findCatalog(app.db);
    const service = findActiveService(services, parsed.data.slug);
    if (!service) return reply.code(404).send({ error: 'Not Found' });
    return { service: publicService(service) };
  });
}
