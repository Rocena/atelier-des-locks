// @ts-check
/**
 * Routes admin des avis (§8, §9) : modération (approuver, refuser), réponse publique, mise en
 * avant, consultation de la photo. Ouvertes à la propriétaire et à l'équipe.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ANY } from '../admin/guard.js';
import { redirectWith } from '../admin/nav.js';
import { audit } from '../audit/service.js';
import { uuidParams } from '../agenda/schemas.js';
import * as repo from './admin-repo.js';

const listQuery = z.object({
  statut: z.enum(repo.REVIEW_STATUSES).default('pending').catch('pending'),
});

const replyForm = z.object({
  reply: z.string().trim().max(1000, 'La réponse est limitée à 1 000 caractères.').optional(),
});

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ config: import('../../config.js').AppConfig }} options
 */
export default async function reviewsAdminRoutes(app, { config }) {
  const any = { config: { roles: ANY } };
  const post = { config: { roles: ANY }, preHandler: app.csrfProtection };

  app.get('/avis', any, async (request, reply) => {
    const q = listQuery.parse(request.query);
    const [reviews, counts] = await Promise.all([
      repo.findReviews(app.db, { status: q.statut }),
      repo.countByStatus(app.db),
    ]);
    return reply.adminPage('admin/avis', {
      title: 'Avis',
      section: 'avis',
      reviews,
      counts,
      statut: q.statut,
    });
  });

  /**
   * @param {'approve'|'reject'} action
   */
  const moderation =
    (action) =>
    /** @param {import('fastify').FastifyRequest} request @param {import('fastify').FastifyReply} reply */
    async (request, reply) => {
      const params = uuidParams.safeParse(request.params);
      if (!params.success) return reply.code(422).send({ error: 'validation' });
      const review = await repo.findReview(app.db, params.data.id);
      if (!review) return reply.callNotFound();
      if (action === 'approve' && !review.consent) {
        return reply.code(409).send({
          error: 'no_consent',
          message: 'La cliente n’a pas accepté la publication de cet avis.',
        });
      }
      await repo.setReviewStatus(
        app.db,
        params.data.id,
        action === 'approve' ? 'approved' : 'rejected',
      );
      await audit(request, `review.${action}`, { type: 'review', id: params.data.id });
      return redirectWith(reply, '/admin/avis', action === 'approve' ? 'approved' : 'rejected');
    };

  app.post('/avis/:id/approuver', post, moderation('approve'));
  app.post('/avis/:id/refuser', post, moderation('reject'));

  app.post('/avis/:id/vedette', post, async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    if (!params.success) return reply.code(422).send({ error: 'validation' });
    const featured = /** @type {any} */ (request.body)?.featured === '1';
    if (!(await repo.setFeatured(app.db, params.data.id, featured))) {
      return reply
        .code(409)
        .send({ error: 'not_approved', message: 'Seul un avis publié peut être mis en avant.' });
    }
    await audit(request, 'review.feature', {
      type: 'review',
      id: params.data.id,
      details: { featured },
    });
    return redirectWith(reply, '/admin/avis?statut=approved', 'saved');
  });

  app.post('/avis/:id/reponse', post, async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    const parsed = replyForm.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(422).send({ error: 'validation' });
    if (!(await repo.setReply(app.db, params.data.id, parsed.data.reply || null)))
      return reply.callNotFound();
    await audit(request, 'review.reply', { type: 'review', id: params.data.id });
    return redirectWith(reply, '/admin/avis?statut=approved', 'replied');
  });

  // Photo d'un avis, même non publié : réservée aux comptes connectés.
  app.get('/avis/:id/photo', any, async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    const relative = params.success ? await repo.findPhotoPath(app.db, params.data.id) : null;
    if (!relative || !/^reviews\/[0-9a-f-]{36}\.webp$/.test(relative)) return reply.callNotFound();
    const file = path.resolve(config.booking.uploadDir, relative);
    try {
      await stat(file);
    } catch {
      return reply.callNotFound();
    }
    reply.header('Content-Type', 'image/webp');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(createReadStream(file));
  });
}
