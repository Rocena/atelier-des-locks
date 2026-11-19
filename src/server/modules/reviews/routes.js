// @ts-check
/**
 * Avis (§8) : page publique /avis, dépôt par lien à jeton /avis/laisser/:token, photos publiées.
 * Aucune logique ici : validation (schemas.js) → service.js → réponse.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { findPublishedPhotoPath, findPublishedReviews } from './repo.js';
import * as reviews from './service.js';
import { reviewForm, tokenParams } from './schemas.js';
import { findCatalog } from '../services/repo.js';
import {
  MAX_PHOTO_BYTES,
  UploadError,
  removePhoto,
  sanitizePhoto,
  storePhoto,
} from '../booking/upload.js';

const { sortByDate, summarizeReviews } = reviews;

/** Messages affichés à la cliente (vouvoiement). */
const MESSAGES = {
  photo_too_large: 'La photo dépasse 8 Mo. Choisissez une image plus légère.',
  photo_bad_type: 'La photo doit être au format JPEG, PNG ou WebP.',
  photo_unreadable: 'Cette photo est illisible. Essayez une autre image.',
  rejected: 'Votre avis n’a pas pu être envoyé. Rechargez la page et réessayez.',
  rate_limited: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
};

/** @param {import('fastify').FastifyReply} reply */
function privatePage(reply) {
  // Pages à jeton : jamais en cache, jamais indexées, jeton jamais transmis en Referer.
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Referrer-Policy', 'no-referrer');
}

const photoParams = z.object({ id: z.uuid() }).strict();

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ config: import('../../config.js').AppConfig, now?: () => Date }} options
 */
export default async function reviewsRoutes(app, { config, now = () => new Date() }) {
  const googleUrl = config.reviews.googleUrl;

  // ─── Page publique ─────────────────────────────────────────────────────────
  app.get('/avis', async (_request, reply) => {
    const published = await findPublishedReviews(app.db);
    const { services } = await findCatalog(app.db);
    return reply.page('pages/avis', 'editorial', {
      title: 'Avis clientes · L’Atelier des Locks, Toulouse',
      description:
        'Les avis vérifiés des clientes de L’Atelier des Locks, laissés après leur rendez-vous : création, resserrage, détox, coloration et coiffure sur locks.',
      reviews: sortByDate(published),
      summary: summarizeReviews(published),
      serviceNames: Object.fromEntries(services.map((s) => [s.slug, s.name])),
      googleReviewUrl: googleUrl,
    });
  });

  // API de lecture publique : avis approuvés uniquement, plus la note moyenne.
  app.get('/api/reviews', async () => {
    const published = await findPublishedReviews(app.db);
    return { summary: summarizeReviews(published), reviews: sortByDate(published) };
  });

  // Photo d'un avis PUBLIÉ (approuvé, consenti). Les autres photos ne sortent jamais du disque.
  app.get('/avis/photos/:id', async (request, reply) => {
    const params = photoParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Not Found' });
    const relative = await findPublishedPhotoPath(app.db, params.data.id);
    if (!relative || !/^reviews\/[0-9a-f-]{36}\.webp$/.test(relative)) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    const file = path.join(config.booking.uploadDir, relative);
    const info = await stat(file).catch(() => null);
    if (!info) return reply.code(404).send({ error: 'Not Found' });
    return reply
      .type('image/webp')
      .header('Cache-Control', 'public, max-age=86400')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Length', info.size)
      .send(createReadStream(file));
  });

  // ─── Dépôt d'un avis : lien personnel ────────────────────────────────────────
  /** @param {number} max @param {string} timeWindow */
  const limit = (max, timeWindow) => ({
    rateLimit: {
      max,
      timeWindow,
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: 'rate_limited',
        message: MESSAGES.rate_limited,
      }),
    },
  });

  /** @param {import('fastify').FastifyReply} reply @param {Record<string, unknown>} [extra] */
  const closedPage = (reply, extra = {}) =>
    reply.page('pages/avis-laisser', 'editorial', {
      title: 'Laisser un avis · L’Atelier des Locks',
      description: 'Partagez votre expérience après votre rendez-vous.',
      noindex: true,
      googleReviewUrl: googleUrl,
      ...extra,
    });

  /**
   * Formulaire, ou message précis si le lien est déjà utilisé, expiré ou inconnu.
   * @param {import('fastify').FastifyReply} reply
   * @param {Awaited<ReturnType<typeof reviews.getReviewForm>>} form
   * @param {{ token: string, errors?: Record<string, string>, values?: Record<string, string>, status?: number }} extra
   */
  function showForm(reply, form, { token, errors = {}, values = {}, status = 200 }) {
    reply.code(status);
    if (form.state !== 'open') return closedPage(reply, { state: form.state });
    return closedPage(reply, {
      state: 'open',
      token,
      view: form.view,
      csrfToken: reply.generateCsrf(),
      errors,
      values: {
        firstName: values.firstName ?? form.view.firstName,
        lastInitial: values.lastInitial ?? form.view.lastInitial,
        rating: values.rating ?? '',
        body: values.body ?? '',
      },
      maxPhotoBytes: MAX_PHOTO_BYTES,
    });
  }

  app.get(
    '/avis/laisser/:token',
    { config: limit(Math.max(30, config.booking.rateLimit * 6), '1 minute') },
    async (request, reply) => {
      privatePage(reply);
      const params = tokenParams.safeParse(request.params);
      if (!params.success) return closedPage(reply.code(404), { state: 'invalid' });
      const form = await reviews.getReviewForm(app.db, params.data.token, now());
      // Après un envoi réussi, le lien est consommé : on affiche le remerciement (et le lien Google).
      if (form.state === 'used' && /** @type {any} */ (request.query)?.envoye === '1') {
        return closedPage(reply, { state: 'thanks' });
      }
      return showForm(reply, form, {
        token: params.data.token,
        status: form.state === 'open' ? 200 : 410,
      });
    },
  );

  // Même plafond que la réservation (BOOKING_RATE_LIMIT) : 5 envois par IP et par 10 minutes par défaut.
  app.post(
    '/avis/laisser/:token',
    { config: limit(config.booking.rateLimit, '10 minutes') },
    async (request, reply) => {
      privatePage(reply);
      const params = tokenParams.safeParse(request.params);
      if (!params.success) return closedPage(reply.code(404), { state: 'invalid' });
      const token = params.data.token;
      if (!request.isMultipart()) return closedPage(reply.code(415), { state: 'invalid' });

      // Formulaire classique (sans JS) : on lit les champs puis on vérifie le jeton CSRF qu'ils portent.
      /** @type {Record<string, string>} */
      const fields = {};
      /** @type {Buffer|null} */
      let photo = null;
      let photoTooLarge = false;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer();
            if (part.fieldname === 'photo' && buffer.length > 0) photo = buffer;
          } else if (typeof part.value === 'string') {
            fields[part.fieldname] = part.value;
          }
        }
      } catch (error) {
        if (/** @type {any} */ (error)?.code === 'FST_REQ_FILE_TOO_LARGE') photoTooLarge = true;
        else return closedPage(reply.code(400), { state: 'invalid' });
      }

      request.body = fields;
      try {
        await new Promise((resolve, reject) => {
          /** @type {any} */ (app.csrfProtection)(request, reply, (/** @type {unknown} */ error) =>
            error ? reject(error) : resolve(undefined),
          );
        });
      } catch {
        return closedPage(reply.code(403), { state: 'invalid', message: MESSAGES.rejected });
      }

      const current = await reviews.getReviewForm(app.db, token, now());
      if (current.state !== 'open') return showForm(reply, current, { token, status: 410 });

      /** @type {Record<string, string>} */
      const errors = {};
      const parsed = reviewForm.safeParse(fields);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors[String(issue.path[0] ?? 'form')] ??= issue.message.startsWith('Invalid')
            ? 'Ce champ est à vérifier.'
            : issue.message;
        }
      }
      if (photoTooLarge) errors.photo = MESSAGES.photo_too_large;

      // Pot de miel rempli : robot. Réponse neutre, rien n'est enregistré.
      if (parsed.success && parsed.data.website) {
        request.log.warn({ event: 'review.honeypot' }, 'pot de miel rempli');
        return closedPage(reply, { state: 'thanks' });
      }

      /** @type {string|null} */
      let photoPath = null;
      if (!Object.keys(errors).length && parsed.success && photo) {
        try {
          photoPath = await storePhoto(
            config.booking.uploadDir,
            await sanitizePhoto(photo),
            'reviews',
          );
        } catch (error) {
          if (!(error instanceof UploadError)) throw error;
          errors.photo = MESSAGES[`photo_${error.code}`];
        }
      }
      if (Object.keys(errors).length || !parsed.success) {
        return showForm(reply, current, { token, errors, values: fields, status: 422 });
      }

      try {
        await reviews.submitReview(app.db, { token, form: parsed.data, photoPath, now: now() });
      } catch (error) {
        if (photoPath) await removePhoto(config.booking.uploadDir, photoPath);
        if (error instanceof reviews.ReviewError) {
          return showForm(
            reply,
            {
              state:
                error.code === 'expired' ? 'expired' : error.code === 'used' ? 'used' : 'invalid',
            },
            { token, status: 410 },
          );
        }
        throw error;
      }
      request.log.info({ event: 'review.submitted' }, 'avis déposé, à modérer');
      return reply.redirect(`/avis/laisser/${token}?envoye=1`, 303);
    },
  );
}
