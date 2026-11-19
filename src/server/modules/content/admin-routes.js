// @ts-check
/**
 * Routes admin des contenus (propriétaire uniquement) : bandeau d'annonce, présentation
 * (chiffres, fondatrice), FAQ, articles du journal, étapes de la vie d'une loc.
 * Les grands textes éditoriaux (histoire, accueil) restent dans les gabarits du site.
 */
import { OWNER } from '../admin/guard.js';
import { redirectWith } from '../admin/nav.js';
import { check, field, row, toValues } from '../admin/forms.js';
import { audit } from '../audit/service.js';
import { fieldErrors } from '../auth/schemas.js';
import { idParams } from '../agenda/schemas.js';
import { bodyToText, parseBody, slugify } from '../services/admin-schemas.js';
import { getSettings, upsertSetting } from '../settings/repo.js';
import { utcToZoned } from '../../lib/zoned-time.js';
import * as repo from './admin-repo.js';
import {
  MAX_STAGES,
  announcementForm,
  announcementId,
  articleForm,
  faqForm,
  parseStages,
  presentationForm,
  readingMinutes,
  stagesToValues,
} from './admin-schemas.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ now: () => Date }} options
 */
export default async function contentAdminRoutes(app, { now }) {
  const opts = { config: { roles: OWNER } };
  const post = { config: { roles: OWNER }, preHandler: app.csrfProtection };

  /** @param {import('fastify').FastifyReply} reply @param {Record<string, unknown>} data */
  const formPage = (reply, data) =>
    reply.adminPage('admin/formulaire', {
      section: 'contenus',
      backHref: '/admin/contenus',
      backLabel: 'Contenus',
      ...data,
    });

  app.get('/contenus', opts, async (_request, reply) => {
    const [articles, faq] = await Promise.all([
      repo.findAdminArticles(app.db),
      repo.findAdminFaq(app.db),
    ]);
    return reply.adminPage('admin/contenus', {
      title: 'Contenus',
      section: 'contenus',
      articles,
      faqCount: faq.reduce((n, g) => n + g.items.length, 0),
    });
  });

  // ─── Bandeau d'annonce ─────────────────────────────────────────────────────
  const announcementFields = [
    check('enabled', 'Afficher le bandeau en haut du site'),
    field('text', 'Message', { maxlength: 200 }),
    row(
      field('linkLabel', 'Texte du lien', { required: false }),
      field('href', 'Adresse du lien', { required: false, hint: '/le-salon ou https://…' }),
    ),
  ];

  app.get('/contenus/bandeau', opts, async (_request, reply) => {
    const { 'site.announcement': a } = await getSettings(app.db, ['site.announcement']);
    return formPage(reply, {
      title: 'Bandeau d’annonce',
      action: '/admin/contenus/bandeau',
      fields: announcementFields,
      values: toValues({
        enabled: a?.enabled === true,
        text: a?.text ?? '',
        linkLabel: a?.linkLabel ?? '',
        href: a?.href ?? '',
      }),
    });
  });

  app.post('/contenus/bandeau', post, async (request, reply) => {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = announcementForm.safeParse(body);
    if (!parsed.success) {
      return formPage(reply.code(422), {
        title: 'Bandeau d’annonce',
        action: '/admin/contenus/bandeau',
        fields: announcementFields,
        values: body,
        errors: fieldErrors(parsed.error),
      });
    }
    const a = parsed.data;
    const { 'site.announcement': previous } = await getSettings(app.db, ['site.announcement']);
    await upsertSetting(app.db, 'site.announcement', {
      enabled: a.enabled,
      id: announcementId(a.text, a.href, previous?.id, previous),
      text: a.text,
      linkLabel: a.linkLabel,
      href: a.href,
    });
    await audit(request, 'content.update', { type: 'content', id: 'announcement' });
    return redirectWith(reply, '/admin/contenus', 'saved');
  });

  // ─── Présentation : chiffres et fondatrice ─────────────────────────────────
  const presentationFields = [
    row(
      field('clients', 'Clientes accompagnées', { type: 'number', inputmode: 'numeric', min: 0 }),
      field('yearsOfPractice', 'Années de pratique', {
        type: 'number',
        inputmode: 'numeric',
        min: 0,
      }),
    ),
    row(
      field('firstName', 'Prénom de la fondatrice', { required: false }),
      field('displayName', 'Nom affiché'),
    ),
    field('role', 'Fonction', { maxlength: 80 }),
  ];

  app.get('/contenus/presentation', opts, async (_request, reply) => {
    const s = await getSettings(app.db, ['site.stats', 'site.founder']);
    return formPage(reply, {
      title: 'Chiffres et présentation',
      lead: 'Ces chiffres sont affichés sur l’accueil : renseignez les vrais.',
      action: '/admin/contenus/presentation',
      fields: presentationFields,
      values: toValues({
        clients: s['site.stats']?.clients ?? 0,
        yearsOfPractice: s['site.stats']?.yearsOfPractice ?? 0,
        firstName: s['site.founder']?.firstName ?? '',
        displayName: s['site.founder']?.displayName ?? '',
        role: s['site.founder']?.role ?? '',
      }),
    });
  });

  app.post('/contenus/presentation', post, async (request, reply) => {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = presentationForm.safeParse(body);
    if (!parsed.success) {
      return formPage(reply.code(422), {
        title: 'Chiffres et présentation',
        action: '/admin/contenus/presentation',
        fields: presentationFields,
        values: body,
        errors: fieldErrors(parsed.error),
      });
    }
    const p = parsed.data;
    await upsertSetting(app.db, 'site.stats', {
      clients: p.clients,
      yearsOfPractice: p.yearsOfPractice,
      isPlaceholder: false,
    });
    await upsertSetting(app.db, 'site.founder', {
      firstName: p.firstName,
      displayName: p.displayName,
      role: p.role,
    });
    await audit(request, 'content.update', { type: 'content', id: 'presentation' });
    return redirectWith(reply, '/admin/contenus', 'saved');
  });

  // ─── FAQ ───────────────────────────────────────────────────────────────────
  app.get('/contenus/faq', opts, async (_request, reply) =>
    reply.adminPage('admin/faq', {
      title: 'Questions fréquentes',
      section: 'contenus',
      groups: await repo.findAdminFaq(app.db),
    }),
  );

  /** @param {Awaited<ReturnType<typeof repo.findFaqGroups>>} groups */
  const faqFields = (groups) => [
    field('groupId', 'Thème', {
      type: 'select',
      options: groups.map((g) => ({ value: g.id, label: g.title })),
    }),
    field('question', 'Question', { maxlength: 300 }),
    field('answer', 'Réponse', { type: 'textarea', rows: 6, maxlength: 3000 }),
  ];

  /** @param {import('fastify').FastifyReply} reply @param {Record<string, unknown>} data */
  const faqPage = async (reply, data) =>
    formPage(reply, {
      backHref: '/admin/contenus/faq',
      backLabel: 'Questions fréquentes',
      fields: faqFields(await repo.findFaqGroups(app.db)),
      ...data,
    });

  app.get('/contenus/faq/nouvelle', opts, async (_request, reply) =>
    faqPage(reply, {
      title: 'Nouvelle question',
      action: '/admin/contenus/faq',
      submitLabel: 'Ajouter la question',
      values: {},
    }),
  );

  /** @param {number|null} id @param {import('fastify').FastifyRequest} request @param {import('fastify').FastifyReply} reply */
  async function saveFaq(id, request, reply) {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = faqForm.safeParse(body);
    if (!parsed.success) {
      return faqPage(reply.code(422), {
        title: id ? 'Modifier la question' : 'Nouvelle question',
        action: id ? `/admin/contenus/faq/${id}` : '/admin/contenus/faq',
        values: body,
        errors: fieldErrors(parsed.error),
      });
    }
    if (id) await repo.updateFaqItem(app.db, id, parsed.data);
    else id = await repo.insertFaqItem(app.db, parsed.data);
    await audit(request, 'faq.update', { type: 'faq', id });
    return redirectWith(reply, '/admin/contenus/faq', 'saved');
  }

  app.post('/contenus/faq', post, (request, reply) => saveFaq(null, request, reply));

  app.get('/contenus/faq/:id', opts, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const item = params.success ? await repo.findFaqItem(app.db, params.data.id) : null;
    if (!item) return reply.callNotFound();
    return faqPage(reply, {
      title: 'Modifier la question',
      action: `/admin/contenus/faq/${item.id}`,
      values: toValues(item),
    });
  });

  app.post('/contenus/faq/:id', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success || !(await repo.findFaqItem(app.db, params.data.id)))
      return reply.callNotFound();
    return saveFaq(params.data.id, request, reply);
  });

  app.post('/contenus/faq/:id/supprimer', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(422).send({ error: 'validation' });
    if (!(await repo.deleteFaqItem(app.db, params.data.id))) return reply.callNotFound();
    await audit(request, 'faq.update', {
      type: 'faq',
      id: params.data.id,
      details: { deleted: true },
    });
    return redirectWith(reply, '/admin/contenus/faq', 'deleted');
  });

  // ─── Articles du journal ───────────────────────────────────────────────────
  const articleFields = [
    field('title', 'Titre', {
      maxlength: 200,
      hint: 'Un *mot* entre astérisques passe en italique.',
    }),
    field('slug', 'Adresse de la page', { required: false, hint: 'Laissez vide pour la générer.' }),
    field('excerpt', 'Résumé', { type: 'textarea', rows: 3, maxlength: 400 }),
    field('body', 'Texte', {
      type: 'textarea',
      rows: 16,
      maxlength: 40000,
      hint: 'Paragraphes séparés par une ligne vide. Une ligne « ## Titre » ouvre une section.',
    }),
    row(
      field('status', 'État', {
        type: 'select',
        options: [
          { value: 'draft', label: 'Brouillon (invisible)' },
          { value: 'published', label: 'Publié' },
        ],
      }),
      field('publishedOn', 'Date de publication', {
        type: 'date',
        required: false,
        hint: 'Aujourd’hui si vide.',
      }),
    ),
  ];

  app.get('/contenus/articles', opts, async (_request, reply) =>
    reply.adminPage('admin/articles', {
      title: 'Articles',
      section: 'contenus',
      articles: await repo.findAdminArticles(app.db),
    }),
  );

  /** @param {import('fastify').FastifyReply} reply @param {Record<string, unknown>} data */
  const articlePage = (reply, data) =>
    formPage(reply, {
      backHref: '/admin/contenus/articles',
      backLabel: 'Articles',
      fields: articleFields,
      ...data,
    });

  app.get('/contenus/articles/nouveau', opts, async (_request, reply) =>
    articlePage(reply, {
      title: 'Nouvel article',
      action: '/admin/contenus/articles',
      submitLabel: 'Créer l’article',
      values: { status: 'draft' },
    }),
  );

  /** @param {number|null} id @param {import('fastify').FastifyRequest} request @param {import('fastify').FastifyReply} reply */
  async function saveArticle(id, request, reply) {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = articleForm.safeParse(body);
    /** @param {Record<string, string>} errors */
    const render = (errors) =>
      articlePage(reply.code(422), {
        title: id ? 'Modifier l’article' : 'Nouvel article',
        action: id ? `/admin/contenus/articles/${id}` : '/admin/contenus/articles',
        values: body,
        errors,
      });
    if (!parsed.success) return render(fieldErrors(parsed.error));
    const a = parsed.data;
    const plainTitle = a.title.replaceAll('*', '');
    const slug = slugify(a.slug || plainTitle);
    if (!slug || (await repo.articleSlugTaken(app.db, slug, id))) {
      return render({ slug: 'Cette adresse est déjà utilisée ou invalide.' });
    }
    const sections = parseBody(a.body);
    const input = {
      slug,
      title: a.title,
      plainTitle,
      excerpt: a.excerpt,
      sections,
      readingMinutes: readingMinutes(sections),
      status: a.status,
      publishedOn:
        a.status === 'published'
          ? (a.publishedOn ?? utcToZoned(now(), 'Europe/Paris').date)
          : (a.publishedOn ?? null),
    };
    if (id) await repo.updateArticle(app.db, id, input);
    else id = await repo.insertArticle(app.db, input);
    await audit(request, 'article.update', { type: 'article', id, details: { status: a.status } });
    return redirectWith(reply, '/admin/contenus/articles', 'saved');
  }

  app.post('/contenus/articles', post, (request, reply) => saveArticle(null, request, reply));

  app.get('/contenus/articles/:id', opts, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const article = params.success ? await repo.findArticle(app.db, params.data.id) : null;
    if (!article) return reply.callNotFound();
    return articlePage(reply, {
      title: 'Modifier l’article',
      action: `/admin/contenus/articles/${article.id}`,
      values: toValues({ ...article, body: bodyToText(article.sections) }),
    });
  });

  app.post('/contenus/articles/:id', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success || !(await repo.findArticle(app.db, params.data.id)))
      return reply.callNotFound();
    return saveArticle(params.data.id, request, reply);
  });

  // ─── Étapes de la vie d'une loc ────────────────────────────────────────────
  /** @param {number} count */
  const stageFields = (count) =>
    Array.from({ length: Math.min(MAX_STAGES, count + 1) }, (_, i) => i + 1).flatMap((n) => [
      row(
        field(`name${n}`, `Étape ${n} : nom`, { required: false, maxlength: 80 }),
        field(`period${n}`, 'Période', { required: false, maxlength: 80 }),
      ),
      field(`text${n}`, 'Description', {
        type: 'textarea',
        rows: 3,
        required: false,
        maxlength: 600,
      }),
    ]);

  app.get('/contenus/etapes', opts, async (_request, reply) => {
    const block = await repo.findBlock(app.db, 'methods.stages');
    const stages = /** @type {{ name: string, period: string, text: string }[]} */ (
      block?.body ?? []
    );
    return formPage(reply, {
      title: 'Étapes de la vie d’une loc',
      lead: 'Affichées sur la page Méthodes. Une ligne vide en bas permet d’ajouter une étape ; videz une étape pour la retirer.',
      action: '/admin/contenus/etapes',
      fields: stageFields(stages.length),
      values: stagesToValues(stages),
    });
  });

  app.post('/contenus/etapes', post, async (request, reply) => {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const { stages, errors } = parseStages(body);
    if (Object.keys(errors).length) {
      return formPage(reply.code(422), {
        title: 'Étapes de la vie d’une loc',
        action: '/admin/contenus/etapes',
        fields: stageFields(MAX_STAGES),
        values: body,
        errors,
      });
    }
    const userId = /** @type {NonNullable<typeof request.admin>} */ (request.admin).user.id;
    await repo.updateBlock(app.db, 'methods.stages', stages, userId);
    await audit(request, 'content.update', { type: 'content', id: 'methods.stages' });
    return redirectWith(reply, '/admin/contenus', 'saved');
  });
}
