// @ts-check
/**
 * Routes admin de la galerie : envoi de photos (une requête par photo, recadrées côté navigateur),
 * étiquettes, texte alternatif obligatoire, ordre, mise en avant, suppression.
 * Plus la diffusion publique des fichiers : /media/galerie/:fichier.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ANY, OWNER } from '../admin/guard.js';
import { redirectWith } from '../admin/nav.js';
import { mergeOrder, moveInList } from '../admin/order.js';
import { audit } from '../audit/service.js';
import { fieldErrors } from '../auth/schemas.js';
import { checkbox, idParams } from '../agenda/schemas.js';
import { UploadError } from '../booking/upload.js';
import { moveBody, reorderBody } from '../services/admin-schemas.js';
import { reorder, orderedIds } from '../services/admin-repo.js';
import * as repo from './admin-repo.js';
import {
  GALLERY_FILE_RE,
  processGalleryImage,
  removeGalleryImage,
  storeGalleryImage,
  suggestAlt,
} from './images.js';

const optionalId = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.coerce.number().int().positive().nullable(),
);

export const itemForm = z.object({
  title: z.string().trim().min(1, 'Donnez un titre à la réalisation.').max(120),
  alt: z
    .string()
    .trim()
    .min(5, 'Le texte alternatif est obligatoire : décrivez la photo en une phrase.')
    .max(300),
  categoryId: optionalId,
  methodId: optionalId,
  sizeTagId: optionalId,
  featured: checkbox,
  active: checkbox.transform((v) => v),
});

const UPLOAD_MESSAGES = /** @type {Record<string, string>} */ ({
  too_large: 'La photo dépasse 8 Mo. Choisissez une image plus légère.',
  bad_type: 'Le fichier doit être une image JPEG, PNG ou WebP.',
  unreadable: 'Cette photo est illisible. Essayez une autre image.',
});

/**
 * Lit un envoi multipart : champs texte et un fichier « photo ».
 * @param {import('fastify').FastifyRequest} request
 */
async function readUpload(request) {
  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {Buffer|null} */
  let photo = null;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (part.fieldname === 'photo' && buffer.length > 0) photo = buffer;
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }
  return { fields, photo };
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ config: import('../../config.js').AppConfig }} options
 */
export default async function galleryAdminRoutes(app, { config }) {
  const uploadDir = config.booking.uploadDir;
  const any = { config: { roles: ANY } };
  const post = { config: { roles: ANY }, preHandler: app.csrfProtection };
  const ownerPost = { config: { roles: OWNER }, preHandler: app.csrfProtection };

  // ─── Liste et envoi ────────────────────────────────────────────────────────
  app.get('/galerie', any, async (_request, reply) => {
    const [items, choices] = await Promise.all([
      repo.findAdminGallery(app.db),
      repo.findGalleryChoices(app.db),
    ]);
    return reply.adminPage('admin/galerie', {
      title: 'Galerie',
      section: 'galerie',
      items,
      choices,
    });
  });

  app.post('/galerie/photos', post, async (request, reply) => {
    if (!request.isMultipart()) return reply.code(415).send({ error: 'multipart' });
    /** @type {Awaited<ReturnType<typeof readUpload>>} */
    let upload;
    try {
      upload = await readUpload(request);
    } catch {
      return reply.code(413).send({ error: 'too_large', message: UPLOAD_MESSAGES.too_large });
    }
    const parsed = itemForm.safeParse({ ...upload.fields, active: '1' });
    if (!parsed.success) {
      return reply.code(422).send({ error: 'validation', fields: fieldErrors(parsed.error) });
    }
    if (!upload.photo) {
      return reply
        .code(422)
        .send({ error: 'validation', fields: { photo: 'Choisissez une photo.' } });
    }
    try {
      const processed = await processGalleryImage(upload.photo);
      const imagePath = await storeGalleryImage(uploadDir, processed);
      const id = await repo.insertItem(app.db, {
        ...parsed.data,
        active: true,
        imagePath,
        ratio: processed.ratio,
      });
      await audit(request, 'gallery.create', {
        type: 'gallery',
        id,
        details: { title: parsed.data.title },
      });
      return reply.code(201).send({ ok: true, id });
    } catch (error) {
      if (error instanceof UploadError) {
        return reply.code(422).send({
          error: 'validation',
          fields: { photo: UPLOAD_MESSAGES[error.code] },
        });
      }
      throw error;
    }
  });

  // ─── Une réalisation ───────────────────────────────────────────────────────
  /** @param {number} id */
  async function itemPage(id) {
    const [item, choices] = await Promise.all([
      repo.findItem(app.db, id),
      repo.findGalleryChoices(app.db),
    ]);
    if (!item) return null;
    const category = choices.categories.find((c) => c.id === item.categoryId)?.name ?? null;
    const method = choices.methods.find((m) => m.id === item.methodId)?.name ?? null;
    const size = choices.sizes.find((s) => s.id === item.sizeTagId)?.name ?? null;
    return { item, choices, suggestion: suggestAlt({ category, method, size }) };
  }

  app.get('/galerie/:id', any, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const data = params.success ? await itemPage(params.data.id) : null;
    if (!data) return reply.callNotFound();
    return reply.adminPage('admin/galerie-photo', {
      title: data.item.title,
      section: 'galerie',
      ...data,
      isOwner: request.admin?.user.role === 'owner',
    });
  });

  app.post('/galerie/:id', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const data = params.success ? await itemPage(params.data.id) : null;
    if (!params.success || !data) return reply.callNotFound();
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = itemForm.safeParse(body);
    if (!parsed.success) {
      return reply.code(422).adminPage('admin/galerie-photo', {
        title: data.item.title,
        section: 'galerie',
        ...data,
        isOwner: request.admin?.user.role === 'owner',
        errors: fieldErrors(parsed.error),
        values: body,
      });
    }
    await repo.updateItem(app.db, params.data.id, parsed.data);
    await audit(request, 'gallery.update', { type: 'gallery', id: params.data.id });
    return redirectWith(reply, `/admin/galerie/${params.data.id}`, 'saved');
  });

  // Remplacement de la photo (le formulaire porte le jeton CSRF dans l'URL : multipart).
  app.post('/galerie/:id/photo', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const item = params.success ? await repo.findItem(app.db, params.data.id) : null;
    if (!params.success || !item) return reply.callNotFound();
    if (!request.isMultipart()) return reply.code(415).send({ error: 'multipart' });
    const back = `/admin/galerie/${params.data.id}`;
    try {
      const { photo } = await readUpload(request);
      if (!photo) return reply.redirect(`${back}?ok=invalid`, 303);
      const processed = await processGalleryImage(photo);
      const imagePath = await storeGalleryImage(uploadDir, processed);
      await repo.updateItem(app.db, params.data.id, {
        title: item.title,
        alt: item.alt,
        categoryId: item.categoryId,
        methodId: item.methodId,
        sizeTagId: item.sizeTagId,
        featured: item.featured,
        active: item.active,
        image: { imagePath, ratio: processed.ratio },
      });
      await removeGalleryImage(uploadDir, item.imagePath);
      await audit(request, 'gallery.update', {
        type: 'gallery',
        id: params.data.id,
        details: { photo: 'replace' },
      });
      return redirectWith(reply, back, 'saved');
    } catch (error) {
      if (error instanceof UploadError) return reply.redirect(`${back}?ok=invalid`, 303);
      throw error;
    }
  });

  app.post('/galerie/:id/vedette', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(422).send({ error: 'validation' });
    const featured = /** @type {any} */ (request.body)?.featured === '1';
    if (!(await repo.setFlags(app.db, params.data.id, { featured }))) return reply.callNotFound();
    await audit(request, 'gallery.update', {
      type: 'gallery',
      id: params.data.id,
      details: { featured },
    });
    return redirectWith(reply, '/admin/galerie', 'saved');
  });

  app.post('/galerie/:id/actif', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(422).send({ error: 'validation' });
    const active = /** @type {any} */ (request.body)?.active === '1';
    if (!(await repo.setFlags(app.db, params.data.id, { active }))) return reply.callNotFound();
    await audit(request, 'gallery.update', {
      type: 'gallery',
      id: params.data.id,
      details: { active },
    });
    return redirectWith(reply, '/admin/galerie', 'saved');
  });

  app.post('/galerie/:id/deplacer', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const move = moveBody.safeParse(request.body);
    if (!params.success || !move.success) return reply.code(422).send({ error: 'validation' });
    const ids = await orderedIds(app.db, 'gallery');
    if (!ids.includes(params.data.id)) return reply.callNotFound();
    await reorder(app.db, 'gallery', moveInList(ids, params.data.id, move.data.direction));
    await audit(request, 'gallery.update', {
      type: 'gallery',
      id: params.data.id,
      details: { order: move.data.direction },
    });
    return redirectWith(reply, '/admin/galerie', 'reordered');
  });

  // Ordre par glisser-déposer : la liste complète des identifiants.
  app.post('/galerie/ordre', post, async (request, reply) => {
    const parsed = reorderBody.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'validation' });
    const all = await orderedIds(app.db, 'gallery');
    const merged = mergeOrder(all, parsed.data.ids);
    if (!merged) return reply.code(422).send({ error: 'validation' });
    await reorder(app.db, 'gallery', merged);
    await audit(request, 'gallery.update', { type: 'gallery', details: { order: 'drag' } });
    return { ok: true };
  });

  // Suppression : propriétaire uniquement (une photo supprimée disparaît du site).
  app.post('/galerie/:id/supprimer', ownerPost, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(422).send({ error: 'validation' });
    const deleted = await repo.deleteItem(app.db, params.data.id);
    if (!deleted) return reply.callNotFound();
    await removeGalleryImage(uploadDir, deleted.imagePath);
    await audit(request, 'gallery.delete', { type: 'gallery', id: params.data.id });
    return redirectWith(reply, '/admin/galerie', 'deleted');
  });
}

/**
 * Diffusion publique des photos de la galerie (hors de /admin : appelée par app.js).
 * Seuls les noms UUID générés par l'application sont servis ; cache long (nom = contenu).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ config: import('../../config.js').AppConfig }} options
 */
export async function galleryMediaRoutes(app, { config }) {
  app.get('/media/galerie/:file', async (request, reply) => {
    const file = /** @type {{ file: string }} */ (request.params).file;
    if (!GALLERY_FILE_RE.test(file)) return reply.callNotFound();
    const target = path.resolve(config.booking.uploadDir, 'gallery', file);
    try {
      await stat(target);
    } catch {
      return reply.callNotFound();
    }
    reply.header('Content-Type', 'image/webp');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(createReadStream(target));
  });
}
