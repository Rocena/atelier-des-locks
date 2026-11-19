// @ts-check
import { findPublishedArticles } from './repo.js';
import { sortArticles } from './service.js';
import { slugParams } from '../catalog/schemas.js';
import { site } from '../../lib/site.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function journalRoutes(app) {
  app.get('/conseils', async (_request, reply) => {
    const articles = sortArticles(await findPublishedArticles());
    return reply.page('pages/conseils', 'editorial', {
      title: 'Conseils locks · Le journal de L’Atelier des Locks',
      description:
        'Débuter ses locks, les laver, choisir son entretien : les conseils d’une locticienne toulousaine, sans jargon.',
      articles,
    });
  });

  app.get('/conseils/:slug', async (request, reply) => {
    const parsed = slugParams.safeParse(request.params);
    if (!parsed.success) return reply.callNotFound();
    const articles = sortArticles(await findPublishedArticles());
    const article = articles.find((a) => a.slug === parsed.data.slug);
    if (!article) return reply.callNotFound();
    return reply.page('pages/article', 'editorial', {
      title: `${article.plainTitle} · L’Atelier des Locks`,
      description: article.excerpt,
      article,
      more: articles.filter((a) => a.slug !== article.slug).slice(0, 2),
      breadcrumb: [
        { label: 'Accueil', href: '/' },
        { label: 'Conseils', href: '/conseils' },
        { label: article.plainTitle, href: `/conseils/${article.slug}` },
      ],
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: article.plainTitle,
          description: article.excerpt,
          datePublished: article.date,
          inLanguage: 'fr-FR',
          publisher: { '@type': 'HairSalon', name: site.name, url: app.publicUrl },
          mainEntityOfPage: `${app.publicUrl}/conseils/${article.slug}`,
        },
      ],
    });
  });
}
