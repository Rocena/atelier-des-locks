// @ts-check
/**
 * Page /styleguide : vitrine du design system (tokens, composants, états).
 * Enregistrée seulement si `config.styleguideEnabled` (désactivée par défaut en prod).
 * @param {import('fastify').FastifyInstance} app
 */
export default async function styleguideRoutes(app) {
  app.get('/styleguide', (_request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    return reply.page('pages/styleguide', 'styleguide', {
      title: 'Styleguide · L’Atelier des Locks',
      description: 'Design system de L’Atelier des Locks.',
      noindex: true,
    });
  });
}
