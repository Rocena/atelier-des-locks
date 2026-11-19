// @ts-check
/**
 * Pages publiques. Phase 0/1 : accueil provisoire uniquement.
 * Les autres pages (§5 du cahier des charges) arrivent en phase 2.
 * @param {import('fastify').FastifyInstance} app
 */
export default async function siteRoutes(app) {
  app.get('/', (_request, reply) =>
    reply.page('pages/home', 'home', {
      title: "L'Atelier des Locks · Locticienne à Toulouse",
      description:
        'Création, entretien et soin des locks à Toulouse, par une locticienne passionnée. Le site ouvre très bientôt.',
    }),
  );
}
