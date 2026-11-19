// @ts-check
/**
 * Routes admin du catalogue (propriétaire uniquement) : catégories, prestations, options,
 * méthodes, activation, ordre (glisser-déposer et boutons). Validation → repo → réponse.
 */
import { OWNER } from '../admin/guard.js';
import { redirectWith } from '../admin/nav.js';
import { check, field, row, toValues, legend } from '../admin/forms.js';
import { mergeOrder, moveInList } from '../admin/order.js';
import { audit } from '../audit/service.js';
import { fieldErrors } from '../auth/schemas.js';
import { idParams } from '../agenda/schemas.js';
import * as repo from './admin-repo.js';
import {
  bodyToText,
  categoryForm,
  centsToEuros,
  methodForm,
  moveBody,
  optionForm,
  parseBody,
  reorderBody,
  serviceForm,
  slugify,
} from './admin-schemas.js';

/** @param {unknown} error */
const isUniqueViolation = (error) => /** @type {any} */ (error)?.code === '23505';

const FAMILIES = [
  { value: 'installation', label: 'Installation' },
  { value: 'maintenance', label: 'Entretien' },
  { value: 'both', label: 'Installation et entretien' },
];

/**
 * @param {import('fastify').FastifyInstance} app
 */
export default async function servicesAdminRoutes(app) {
  const opts = { config: { roles: OWNER } };
  const post = { config: { roles: OWNER }, preHandler: app.csrfProtection };

  // ─── Liste ─────────────────────────────────────────────────────────────────
  app.get('/prestations', opts, async (_request, reply) => {
    const catalog = await repo.findAdminCatalog(app.db);
    const methods = await repo.findAdminMethods(app.db);
    return reply.adminPage('admin/prestations', {
      title: 'Prestations et tarifs',
      section: 'prestations',
      ...catalog,
      methods,
    });
  });

  // Ordre par glisser-déposer : le JS envoie la liste complète d'un groupe.
  app.post('/prestations/ordre/:table', post, async (request, reply) => {
    const table = /** @type {{ table: string }} */ (request.params).table;
    if (!['services', 'categories', 'options', 'methods'].includes(table))
      return reply.callNotFound();
    const parsed = reorderBody.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: 'validation' });
    await repo.reorder(app.db, /** @type {any} */ (table), parsed.data.ids);
    await audit(request, 'service.reorder', {
      type: table,
      details: { count: parsed.data.ids.length },
    });
    return { ok: true };
  });

  // ─── Catégories ────────────────────────────────────────────────────────────
  const categoryFields = [
    field('name', 'Nom', { maxlength: 80 }),
    field('slug', 'Adresse de la page', {
      required: false,
      hint: 'Laissez vide pour la générer à partir du nom.',
    }),
    field('headline', 'Titre de la page', {
      hint: 'Un *mot* entre astérisques passe en italique.',
      maxlength: 200,
    }),
    field('summary', 'Résumé', { type: 'textarea', rows: 3, maxlength: 400 }),
    field('intro', 'Introduction', { type: 'textarea', rows: 5, maxlength: 2000 }),
    field('mediaLabel', 'Libellé du visuel', { maxlength: 120 }),
    check('active', 'Affichée sur le site', { checked: true }),
  ];

  /** @param {import('fastify').FastifyReply} reply @param {Record<string, unknown>} data */
  const categoryPage = (reply, data) =>
    reply.adminPage('admin/formulaire', {
      section: 'prestations',
      backHref: '/admin/prestations',
      backLabel: 'Prestations',
      fields: categoryFields,
      ...data,
    });

  app.get('/prestations/categories/nouvelle', opts, async (_request, reply) =>
    categoryPage(reply, {
      title: 'Nouvelle catégorie',
      action: '/admin/prestations/categories',
      submitLabel: 'Créer la catégorie',
      values: toValues({ active: true }),
    }),
  );

  /** @param {number|null} id */
  async function saveCategory(
    id,
    /** @type {import('fastify').FastifyRequest} */ request,
    /** @type {import('fastify').FastifyReply} */ reply,
  ) {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = categoryForm.safeParse(body);
    const render = (/** @type {Record<string, string>} */ errors) =>
      categoryPage(reply.code(422), {
        title: id ? 'Modifier la catégorie' : 'Nouvelle catégorie',
        action: id ? `/admin/prestations/categories/${id}` : '/admin/prestations/categories',
        submitLabel: id ? 'Enregistrer' : 'Créer la catégorie',
        values: body,
        errors,
      });
    if (!parsed.success) return render(fieldErrors(parsed.error));
    const c = parsed.data;
    const slug = c.slug || slugify(c.name);
    if (!slug || (await repo.categorySlugTaken(app.db, slug, id))) {
      return render({ slug: 'Cette adresse est déjà utilisée ou invalide.' });
    }
    const input = { ...c, slug };
    if (id) await repo.updateCategory(app.db, id, input);
    else id = await repo.insertCategory(app.db, input);
    await audit(request, 'category.update', { type: 'category', id });
    return redirectWith(reply, '/admin/prestations', id ? 'saved' : 'created');
  }

  app.post('/prestations/categories', post, (request, reply) => saveCategory(null, request, reply));

  app.get('/prestations/categories/:id', opts, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const category = params.success ? await repo.findCategory(app.db, params.data.id) : null;
    if (!category) return reply.callNotFound();
    return categoryPage(reply, {
      title: 'Modifier la catégorie',
      heading: category.name,
      action: `/admin/prestations/categories/${category.id}`,
      values: toValues(category),
    });
  });

  app.post('/prestations/categories/:id', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success || !(await repo.findCategory(app.db, params.data.id)))
      return reply.callNotFound();
    return saveCategory(params.data.id, request, reply);
  });

  // ─── Prestations ───────────────────────────────────────────────────────────
  /** @param {Awaited<ReturnType<typeof repo.findAdminCatalog>>['categories']} categories */
  const serviceFields = (categories) => [
    field('name', 'Nom', { maxlength: 120 }),
    field('slug', 'Adresse de la page', {
      required: false,
      hint: 'Laissez vide pour la générer à partir du nom.',
    }),
    field('categoryId', 'Catégorie', {
      type: 'select',
      required: false,
      options: [
        { value: '', label: 'Sans catégorie' },
        ...categories.map((c) => ({ value: c.id, label: c.name })),
      ],
    }),
    field('summary', 'Description courte', { type: 'textarea', rows: 3, maxlength: 400 }),
    field('body', 'Description détaillée', {
      type: 'textarea',
      rows: 10,
      required: false,
      maxlength: 12000,
      hint: 'Séparez les paragraphes par une ligne vide. Une ligne « ## Titre » ouvre une section.',
    }),
    legend('Durée et prix'),
    row(
      field('durationMin', 'Durée minimale (min)', {
        type: 'number',
        inputmode: 'numeric',
        min: 5,
        step: 5,
      }),
      field('durationMax', 'Durée maximale (min)', {
        type: 'number',
        inputmode: 'numeric',
        min: 5,
        step: 5,
      }),
    ),
    row(
      field('price', 'Prix (€)', {
        inputmode: 'decimal',
        required: false,
        hint: 'Vide si sur devis.',
      }),
      field('bufferAfter', 'Rangement après (min)', {
        type: 'number',
        inputmode: 'numeric',
        min: 0,
        step: 5,
      }),
    ),
    check('priceFrom', 'Afficher « à partir de »'),
    check('onQuote', 'Sur devis (pas de prix affiché)'),
    legend('Visibilité'),
    check('active', 'Affichée sur le site', { checked: true }),
    check('bookableOnline', 'Réservable en ligne', { checked: true }),
    check('allergyTest', 'Test d’allergie 48 h avant (coloration)'),
    check('featured', 'Mise en avant'),
    check('confirmed', 'Prix et durées validés par la propriétaire', {
      hint: 'Retire la mention « à confirmer » dans l’admin.',
    }),
  ];

  /** @param {Record<string, unknown>} data */
  const servicePage = async (/** @type {import('fastify').FastifyReply} */ reply, data) => {
    const { categories } = await repo.findAdminCatalog(app.db);
    return reply.adminPage('admin/formulaire', {
      section: 'prestations',
      backHref: '/admin/prestations',
      backLabel: 'Prestations',
      fields: serviceFields(categories),
      ...data,
    });
  };

  app.get('/prestations/nouvelle', opts, async (_request, reply) =>
    servicePage(reply, {
      title: 'Nouvelle prestation',
      action: '/admin/prestations',
      submitLabel: 'Créer la prestation',
      values: toValues({
        active: true,
        bookableOnline: true,
        bufferAfter: 0,
        durationMin: 60,
        durationMax: 60,
      }),
    }),
  );

  /**
   * @param {number|null} id
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} reply
   */
  async function saveService(id, request, reply) {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = serviceForm.safeParse(body);
    /** @param {Record<string, string>} errors */
    const render = (errors) =>
      servicePage(reply.code(422), {
        title: id ? 'Modifier la prestation' : 'Nouvelle prestation',
        action: id ? `/admin/prestations/${id}` : '/admin/prestations',
        submitLabel: id ? 'Enregistrer' : 'Créer la prestation',
        values: body,
        errors,
      });
    if (!parsed.success) return render(fieldErrors(parsed.error));
    const s = parsed.data;
    const slug = s.slug || slugify(s.name);
    if (!slug || (await repo.serviceSlugTaken(app.db, slug, id))) {
      return render({ slug: 'Cette adresse est déjà utilisée ou invalide.' });
    }
    const input = {
      slug,
      categoryId: s.categoryId,
      name: s.name,
      summary: s.summary,
      body: parseBody(s.body),
      durationMin: s.durationMin,
      durationMax: s.durationMax,
      bufferAfter: s.bufferAfter,
      priceCents: s.onQuote ? null : s.price,
      priceFrom: s.priceFrom && !s.onQuote,
      onQuote: s.onQuote,
      active: s.active,
      bookableOnline: s.bookableOnline,
      allergyTest: s.allergyTest,
      featured: s.featured,
      isPlaceholder: !s.confirmed,
    };
    try {
      if (id) await repo.updateService(app.db, id, input);
      else id = await repo.insertService(app.db, input);
    } catch (error) {
      if (isUniqueViolation(error)) return render({ slug: 'Cette adresse est déjà utilisée.' });
      throw error;
    }
    await audit(request, id ? 'service.update' : 'service.create', {
      type: 'service',
      id,
      details: { name: s.name, active: s.active },
    });
    return redirectWith(reply, `/admin/prestations/${id}`, 'saved');
  }

  app.post('/prestations', post, (request, reply) => saveService(null, request, reply));

  app.get('/prestations/:id', opts, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const service = params.success ? await repo.findService(app.db, params.data.id) : null;
    if (!service) return reply.callNotFound();
    return servicePage(reply, {
      title: service.name,
      action: `/admin/prestations/${service.id}`,
      values: toValues({
        ...service,
        price: centsToEuros(service.price === null ? null : Math.round(service.price * 100)),
        body: bodyToText(service.body),
        confirmed: !service.isPlaceholder,
      }),
      service,
      afterTemplate: '../partials/admin-service-options',
    });
  });

  app.post('/prestations/:id', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success || !(await repo.findService(app.db, params.data.id)))
      return reply.callNotFound();
    return saveService(params.data.id, request, reply);
  });

  app.post('/prestations/:id/actif', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const active = /** @type {any} */ (request.body)?.active === '1';
    if (!params.success) return reply.code(422).send({ error: 'validation' });
    if (!(await repo.setServiceActive(app.db, params.data.id, active))) return reply.callNotFound();
    await audit(request, 'service.update', {
      type: 'service',
      id: params.data.id,
      details: { active },
    });
    return redirectWith(reply, '/admin/prestations', 'saved');
  });

  /** Monter / descendre : boutons pour le clavier et pour les écrans sans glisser-déposer. */
  app.post('/prestations/:id/deplacer', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const move = moveBody.safeParse(request.body);
    if (!params.success || !move.success) return reply.code(422).send({ error: 'validation' });
    const scope = await repo.findServiceScope(app.db, params.data.id);
    if (!scope) return reply.callNotFound();
    const ids = await repo.orderedIds(app.db, 'services', {
      scopeColumn: 'category_id',
      scopeValue: scope.categoryId,
    });
    // On réordonne tout le catalogue : les positions du groupe sont réattribuées dans l'ordre.
    const all = await repo.orderedIds(app.db, 'services');
    const group = moveInList(ids, params.data.id, move.data.direction);
    await repo.reorder(app.db, 'services', mergeOrder(all, group) ?? all);
    await audit(request, 'service.reorder', { type: 'service', id: params.data.id });
    return redirectWith(reply, '/admin/prestations', 'reordered');
  });

  app.post('/prestations/categories/:id/deplacer', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const move = moveBody.safeParse(request.body);
    if (!params.success || !move.success) return reply.code(422).send({ error: 'validation' });
    const ids = await repo.orderedIds(app.db, 'categories');
    if (!ids.includes(params.data.id)) return reply.callNotFound();
    await repo.reorder(app.db, 'categories', moveInList(ids, params.data.id, move.data.direction));
    await audit(request, 'service.reorder', { type: 'category', id: params.data.id });
    return redirectWith(reply, '/admin/prestations', 'reordered');
  });

  // ─── Options ───────────────────────────────────────────────────────────────
  app.post('/prestations/:id/options', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success || !(await repo.findService(app.db, params.data.id)))
      return reply.callNotFound();
    const parsed = optionForm.safeParse(request.body);
    const back = `/admin/prestations/${params.data.id}`;
    if (!parsed.success) return reply.redirect(`${back}?ok=invalid#options`, 303);
    try {
      await repo.insertOption(app.db, params.data.id, {
        label: parsed.data.label,
        priceCents: /** @type {number} */ (parsed.data.price),
        extraMinutes: parsed.data.extraMinutes,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    await audit(request, 'service.update', {
      type: 'service',
      id: params.data.id,
      details: { option: 'add' },
    });
    return redirectWith(reply, `${back}#options`, 'created');
  });

  app.post('/prestations/options/:id', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const parsed = optionForm.safeParse(request.body);
    if (!params.success) return reply.code(422).send({ error: 'validation' });
    const scope = await repo.findOptionScope(app.db, params.data.id);
    if (!scope) return reply.callNotFound();
    const back = `/admin/prestations/${scope.serviceId}`;
    if (!parsed.success) return reply.redirect(`${back}?ok=invalid#options`, 303);
    await repo.updateOption(app.db, params.data.id, {
      label: parsed.data.label,
      priceCents: /** @type {number} */ (parsed.data.price),
      extraMinutes: parsed.data.extraMinutes,
      active: parsed.data.active,
    });
    await audit(request, 'service.update', {
      type: 'service',
      id: scope.serviceId,
      details: { option: 'update' },
    });
    return redirectWith(reply, `${back}#options`, 'saved');
  });

  app.post('/prestations/options/:id/supprimer', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(422).send({ error: 'validation' });
    const serviceId = await repo.deleteOption(app.db, params.data.id);
    if (serviceId === null) return reply.callNotFound();
    await audit(request, 'service.update', {
      type: 'service',
      id: serviceId,
      details: { option: 'delete' },
    });
    return redirectWith(reply, `/admin/prestations/${serviceId}#options`, 'deleted');
  });

  app.post('/prestations/options/:id/deplacer', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const move = moveBody.safeParse(request.body);
    if (!params.success || !move.success) return reply.code(422).send({ error: 'validation' });
    const scope = await repo.findOptionScope(app.db, params.data.id);
    if (!scope) return reply.callNotFound();
    const ids = await repo.orderedIds(app.db, 'options', {
      scopeColumn: 'service_id',
      scopeValue: scope.serviceId,
    });
    await repo.reorder(app.db, 'options', moveInList(ids, params.data.id, move.data.direction));
    return redirectWith(reply, `/admin/prestations/${scope.serviceId}#options`, 'reordered');
  });

  // ─── Méthodes ──────────────────────────────────────────────────────────────
  const methodFields = [
    row(
      field('name', 'Nom', { maxlength: 80 }),
      field('aka', 'Nom courant en français', { required: false }),
    ),
    field('slug', 'Adresse de la page', {
      required: false,
      hint: 'Laissez vide pour la générer à partir du nom.',
    }),
    field('family', 'Famille', { type: 'select', options: FAMILIES }),
    field('summary', 'Résumé', { type: 'textarea', rows: 3, maxlength: 600 }),
    field('principle', 'Principe', { type: 'textarea', rows: 5, maxlength: 2000 }),
    field('idealFor', 'Idéal pour', { type: 'textarea', rows: 3, maxlength: 600 }),
    row(
      field('durationLabel', 'Durée', { hint: 'Ex. « 3 à 5 h ».' }),
      field('maturation', 'Maturation', { maxlength: 600 }),
    ),
    field('maintenance', 'Entretien', { type: 'textarea', rows: 3, maxlength: 600 }),
    field('pros', 'Avantages (un par ligne)', { type: 'textarea', rows: 4, required: false }),
    field('watchouts', 'Points de vigilance (un par ligne)', {
      type: 'textarea',
      rows: 4,
      required: false,
    }),
    check('featured', 'Mise en avant'),
  ];

  /** @param {import('fastify').FastifyReply} reply @param {Record<string, unknown>} data */
  const methodPage = (reply, data) =>
    reply.adminPage('admin/formulaire', {
      section: 'prestations',
      backHref: '/admin/prestations',
      backLabel: 'Prestations',
      fields: methodFields,
      ...data,
    });

  app.get('/prestations/methodes/nouvelle', opts, async (_request, reply) =>
    methodPage(reply, {
      title: 'Nouvelle méthode',
      action: '/admin/prestations/methodes',
      submitLabel: 'Créer la méthode',
      values: {},
    }),
  );

  /**
   * @param {number|null} id
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} reply
   */
  async function saveMethod(id, request, reply) {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = methodForm.safeParse(body);
    /** @param {Record<string, string>} errors */
    const render = (errors) =>
      methodPage(reply.code(422), {
        title: id ? 'Modifier la méthode' : 'Nouvelle méthode',
        action: id ? `/admin/prestations/methodes/${id}` : '/admin/prestations/methodes',
        values: body,
        errors,
      });
    if (!parsed.success) return render(fieldErrors(parsed.error));
    const slug = parsed.data.slug || slugify(parsed.data.name);
    if (!slug || (await repo.methodSlugTaken(app.db, slug, id))) {
      return render({ slug: 'Cette adresse est déjà utilisée ou invalide.' });
    }
    const input = { ...parsed.data, slug };
    if (id) await repo.updateMethod(app.db, id, input);
    else id = await repo.insertMethod(app.db, input);
    await audit(request, 'service.update', {
      type: 'method',
      id,
      details: { name: parsed.data.name },
    });
    return redirectWith(reply, '/admin/prestations', 'saved');
  }

  app.post('/prestations/methodes', post, (request, reply) => saveMethod(null, request, reply));

  app.get('/prestations/methodes/:id', opts, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const method = params.success ? await repo.findMethod(app.db, params.data.id) : null;
    if (!method) return reply.callNotFound();
    return methodPage(reply, {
      title: 'Modifier la méthode',
      heading: method.name,
      action: `/admin/prestations/methodes/${method.id}`,
      values: toValues({
        ...method,
        pros: method.pros.join('\n'),
        watchouts: method.watchouts.join('\n'),
      }),
    });
  });

  app.post('/prestations/methodes/:id', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success || !(await repo.findMethod(app.db, params.data.id)))
      return reply.callNotFound();
    return saveMethod(params.data.id, request, reply);
  });
}
