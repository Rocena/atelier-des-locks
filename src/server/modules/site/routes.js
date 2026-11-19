// @ts-check
/**
 * Pages publiques éditoriales : accueil, le salon, contact, FAQ, réservation (vitrine),
 * pages légales, sitemap.xml et robots.txt.
 */
import { findFaq, findSettings } from './repo.js';
import { faqJsonLd, hairSalonJsonLd, sitemapXml } from './service.js';
import { findCatalog, findMethods } from '../catalog/repo.js';
import { groupByCategory } from '../catalog/service.js';
import { findGallery } from '../gallery/repo.js';
import { findPublishedReviews } from '../reviews/repo.js';
import { featuredReviews, summarizeReviews } from '../reviews/service.js';
import { findPublishedArticles } from '../journal/repo.js';
import { site } from '../../lib/site.js';

/** Pages légales : chemin → template et titre. */
const LEGAL = /** @type {const} */ ([
  {
    path: '/mentions-legales',
    template: 'pages/legal/mentions-legales',
    title: 'Mentions légales',
    description: 'Éditeur, hébergeur et propriété intellectuelle du site L’Atelier des Locks.',
  },
  {
    path: '/confidentialite',
    template: 'pages/legal/confidentialite',
    title: 'Politique de confidentialité',
    description:
      'Quelles données nous collectons, pourquoi, combien de temps nous les gardons et comment exercer vos droits.',
  },
  {
    path: '/cgv-politique-rdv',
    template: 'pages/legal/cgv-politique-rdv',
    title: 'Conditions de vente et politique de rendez-vous',
    description:
      'Réservation, annulation, retard, test d’allergie et paiement : les règles de nos rendez-vous.',
  },
]);

/** @param {import('fastify').FastifyInstance} app */
export default async function siteRoutes(app) {
  app.get('/', async (_request, reply) => {
    const [{ categories, services }, { methods }, { items }, reviews, settings] = await Promise.all(
      [findCatalog(), findMethods(), findGallery(), findPublishedReviews(), findSettings()],
    );
    const summary = summarizeReviews(reviews);
    return reply.page('pages/home', 'home', {
      title: 'L’Atelier des Locks · Locticienne à Toulouse, création et entretien des locks',
      description:
        'Création, resserrage, détox, coloration et coiffure sur locks à Toulouse, par une locticienne passionnée. Réservez votre rendez-vous en ligne.',
      categories: groupByCategory(categories, services).groups,
      methods: methods.filter((m) => m.featured),
      gallery: items.filter((i) => i.featured),
      reviews: featuredReviews(reviews, 3),
      summary,
      settings,
      jsonLd: [hairSalonJsonLd(site, app.publicUrl, summary)],
    });
  });

  app.get('/le-salon', async (_request, reply) => {
    const settings = await findSettings();
    return reply.page('pages/le-salon', 'editorial', {
      title: 'Le salon · De Dakar à Toulouse, L’Atelier des Locks',
      description:
        'Notre histoire, de Dakar à Toulouse, la fondatrice, notre approche du soin des locks et le salon.',
      settings,
    });
  });

  app.get('/contact', async (_request, reply) => {
    const reviews = await findPublishedReviews();
    return reply.page('pages/contact', 'editorial', {
      title: 'Contact et accès · L’Atelier des Locks, Toulouse',
      description:
        'Adresse, horaires, plan d’accès et contact WhatsApp de L’Atelier des Locks, salon de locks à Toulouse.',
      jsonLd: [hairSalonJsonLd(site, app.publicUrl, summarizeReviews(reviews))],
    });
  });

  app.get('/faq', async (_request, reply) => {
    const groups = await findFaq();
    return reply.page('pages/faq', 'editorial', {
      title: 'Questions fréquentes · L’Atelier des Locks',
      description:
        'Préparer son rendez-vous, durée d’une création, entretien des locks, annulation et paiement : nos réponses.',
      groups,
      jsonLd: [faqJsonLd(groups)],
    });
  });

  // Vitrine du tunnel de réservation : le module fonctionnel arrive dans une phase suivante.
  app.get('/reserver', async (_request, reply) => {
    const { categories, services } = await findCatalog();
    return reply.page('pages/reserver', 'editorial', {
      title: 'Réserver un rendez-vous · L’Atelier des Locks',
      description: 'Réservez votre rendez-vous locks à Toulouse en quatre étapes.',
      ...groupByCategory(categories, services),
    });
  });

  for (const page of LEGAL) {
    app.get(page.path, (_request, reply) =>
      reply.page(page.template, 'editorial', {
        title: `${page.title} · L’Atelier des Locks`,
        description: page.description,
        heading: page.title,
      }),
    );
  }

  app.get('/robots.txt', (_request, reply) =>
    reply
      .type('text/plain; charset=utf-8')
      .send(
        `User-agent: *\nDisallow: /admin\nDisallow: /rdv/\nDisallow: /avis/laisser/\nDisallow: /styleguide\n\nSitemap: ${app.publicUrl}/sitemap.xml\n`,
      ),
  );

  app.get('/sitemap.xml', async (_request, reply) => {
    const [{ services }, articles] = await Promise.all([findCatalog(), findPublishedArticles()]);
    const paths = [
      '/',
      '/prestations',
      ...services.filter((s) => s.active).map((s) => `/prestations/${s.slug}`),
      '/methodes',
      '/galerie',
      '/tarifs',
      '/avis',
      '/le-salon',
      '/conseils',
      ...articles.map((a) => `/conseils/${a.slug}`),
      '/faq',
      '/contact',
      '/reserver',
      ...LEGAL.map((p) => p.path),
    ];
    return reply.type('application/xml; charset=utf-8').send(sitemapXml(app.publicUrl, paths));
  });
}
