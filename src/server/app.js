// @ts-check
/**
 * Création de l'application Fastify : plugins de sécurité, rendu des pages, modules métier.
 * Aucune logique métier ici : chaque domaine vit dans src/server/modules/<domaine>/.
 */
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import csrf from '@fastify/csrf-protection';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { fileURLToPath } from 'node:url';
import { createPool } from './db/pool.js';
import { createAssetResolver } from './lib/assets.js';
import { createRenderer } from './lib/view.js';
import { site, withContact } from './lib/site.js';
import { fmt } from './lib/format.js';
import siteRoutes from './modules/site/routes.js';
import servicesRoutes from './modules/services/routes.js';
import galleryRoutes from './modules/gallery/routes.js';
import reviewsRoutes from './modules/reviews/routes.js';
import contentRoutes from './modules/content/routes.js';
import { findCatalog } from './modules/services/repo.js';
import { buildNavigation } from './modules/services/service.js';
import { findSettings } from './modules/content/repo.js';
import styleguideRoutes from './modules/styleguide/routes.js';
import bookingRoutes from './modules/booking/routes.js';
import adminShell from './modules/admin/index.js';
import { sessionCookieName } from './modules/admin/guard.js';
import { galleryMediaRoutes } from './modules/gallery/admin-routes.js';
import { MAX_PHOTO_BYTES } from './modules/booking/upload.js';
import { createNotifier } from './modules/notifications/service.js';
import { createProvider } from './modules/notifications/providers.js';
import { createMemoryQueue, createPgBossQueue } from './modules/notifications/queue.js';

/**
 * @typedef {object} BuildOptions
 * @property {import('./config.js').AppConfig} config
 * @property {import('vite').ViteDevServer} [vite]  serveur Vite en mode middleware (dev)
 * @property {boolean} [logger]
 * @property {import('pg').Pool} [db]  pool PostgreSQL (créé depuis la config s'il est absent)
 * @property {() => Date} [now]  horloge (les tests la figent)
 * @property {import('./modules/notifications/queue.js').JobQueue} [queue]  file de jobs (mémoire en test, pg-boss sinon)
 * @property {import('./modules/notifications/providers.js').NotificationProvider} [provider]  fournisseur d'envoi (config sinon)
 */

/**
 * Directives CSP. En production : stricte, nonces uniquement.
 * En dev : on autorise le websocket HMR de Vite.
 * @param {boolean} dev
 */
function cspDirectives(dev) {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    // blob: : aperçu local de la photo des cheveux avant envoi (jamais d'image distante).
    imgSrc: ["'self'", 'data:', 'blob:'],
    fontSrc: ["'self'"],
    connectSrc: dev ? ["'self'", 'ws:'] : ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: dev ? null : [],
  };
}

/**
 * URL sans paramètres et sans jeton : /rdv/<jeton>, /avis/laisser/<jeton>, /agenda/<jeton>.ics.
 * @param {string} url
 */
export function redactUrl(url) {
  const path = url.split('?')[0];
  return path.replace(/^(\/(?:rdv|avis\/laisser|agenda))\/[^/]+/, '$1/[jeton]');
}

/** @param {BuildOptions} options */
export async function buildApp({ config, vite, logger = true, db, now, queue, provider }) {
  const dev = !config.isProd;
  const app = Fastify({
    logger: logger && {
      level: config.env === 'test' ? 'silent' : 'info',
      // Jamais de données personnelles dans les logs : en-têtes sensibles masqués, URL sans jeton
      // ni paramètres, adresse IP non journalisée.
      redact: ['req.headers.cookie', 'req.headers.authorization'],
      serializers: {
        req: (/** @type {{ method?: string, url?: string }} */ request) => ({
          method: request.method,
          url: redactUrl(request.url ?? ''),
        }),
      },
    },
    // Seuls les proxys listés (Caddy en local) peuvent fixer l'adresse du visiteur.
    trustProxy: config.isProd ? config.trustProxy : false,
  });

  await app.register(helmet, {
    enableCSPNonces: true,
    contentSecurityPolicy: { directives: cspDirectives(dev) },
    hsts: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  // Cookies signés (jeton CSRF), formulaires classiques, uploads limités, limitation de débit.
  app.addHook('onSend', async (_request, reply) => {
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(csrf, {
    sessionPlugin: '@fastify/cookie',
    cookieOpts: { path: '/', httpOnly: true, sameSite: 'lax', secure: config.isProd, signed: true },
  });
  await app.register(formbody, { bodyLimit: 16 * 1024 });
  await app.register(multipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 40, fieldSize: 4096, parts: 41 },
  });
  // Pas de limite globale : chaque route sensible déclare la sienne (réservation, gestion, flux).
  await app.register(rateLimit, { global: false });

  // Compression brotli/gzip des réponses (HTML, CSS, JS, SVG) : -70 % sur le transfert.
  await app.register(compress, { global: true, threshold: 1024 });

  if (vite) {
    const middie = (await import('@fastify/middie')).default;
    await app.register(middie);
    app.use(vite.middlewares);
  } else if (config.isProd) {
    await app.register(fastifyStatic, {
      root: fileURLToPath(new URL('../../dist/client', import.meta.url)),
      prefix: '/',
      index: false,
      // Fichiers hashés par Vite (/assets/) : cache long. Le reste (logos, favicon) : 1 jour.
      cacheControl: false,
      setHeaders: (res, filePath) => {
        const hashed = /[\\/]assets[\\/]/.test(filePath);
        res.header(
          'Cache-Control',
          hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
        );
      },
    });
  }

  app.decorate('publicUrl', config.publicUrl);
  // Adaptateur de réservation : les boutons « Réserver » pointent vers notre tunnel ou vers Fresha.
  const bookingHref =
    config.booking.provider === 'fresha_link' ? config.booking.freshaUrl : '/reserver';
  app.decorate('bookingProvider', config.booking.provider);

  // Pool PostgreSQL partagé par tous les modules (les repo.js reçoivent app.db). Fermé avec l'app.
  const pool = db ?? createPool(config.databaseUrl);
  app.decorate('db', pool);
  if (!db) app.addHook('onClose', () => pool.end());

  // Notifications (§7.6) : jobs pg-boss en base. En test, file en mémoire (rien ne part, rien ne dort).
  // Le démarrage des workers se fait dans index.js (app.notifications.start()), pas ici.
  const notifications = createNotifier({
    db: pool,
    queue:
      queue ??
      (config.env === 'test'
        ? createMemoryQueue()
        : createPgBossQueue({
            connectionString: config.databaseUrl,
            onError: (error) => app.log.error({ err: error }, 'file de jobs'),
          })),
    provider:
      provider ?? createProvider(config.notifications, { log: (line) => app.log.info(line) }),
    config,
    site,
    now,
    log: app.log,
  });
  app.decorate('notifications', notifications);
  app.addHook('onClose', () => notifications.stop());

  const resolveAssets = createAssetResolver({ dev: !config.isProd });
  // Données communes à toutes les pages (méga-menu, bandeau d'annonce), relues en base au plus
  // toutes les 30 s en production (1 s en dev) : une modification admin se voit sans redémarrage.
  const SHARED_TTL_MS = config.isProd ? 30_000 : 1_000;
  async function loadShared() {
    const [{ categories, services }, settings] = await Promise.all([
      findCatalog(pool),
      findSettings(pool),
    ]);
    return { navigation: buildNavigation(categories, services), settings, loadedAt: Date.now() };
  }
  let shared = await loadShared();
  // Un seul rechargement à la fois, en arrière-plan : les requêtes servent la version en cache.
  // Avant, chaque requête (y compris chaque module JS servi par Vite en dev) relançait 7 requêtes
  // SQL dès l'expiration : sous charge, le pool PostgreSQL saturait et l'API ne répondait plus.
  /** @type {Promise<void>|null} */
  let refreshing = null;
  app.addHook('onRequest', async () => {
    if (refreshing || Date.now() - shared.loadedAt <= SHARED_TTL_MS) return;
    refreshing = loadShared()
      .then((fresh) => {
        shared = fresh;
      })
      .catch((error) => app.log.error({ err: error }, 'rechargement des données communes'))
      .finally(() => {
        refreshing = null;
      });
  });
  const render = createRenderer({ cache: config.isProd });

  /**
   * Rend une page complète (layout + template) avec ses assets et le nonce CSP.
   * @param {string} template
   * @param {import('../client/entries.js').EntryName} entry
   * @param {Record<string, unknown>} [data]
   */
  function page(template, entry, data = {}) {
    // @ts-expect-error reply est injecté par Fastify (this)
    const reply = /** @type {import('fastify').FastifyReply} */ (this);
    const pathname = reply.request.url.split('?')[0];
    const jsonLd = /** @type {unknown[]} */ (data.jsonLd ?? []).map((item) =>
      // JSON dans <script> : on neutralise « < » pour qu'aucune chaîne ne ferme la balise.
      JSON.stringify(item).replaceAll('<', String.fromCharCode(92) + 'u003c'),
    );
    const html = render(template, {
      settings: shared.settings,
      ...data,
      jsonLd,
      site: withContact(site, shared.settings.contact),
      navigation: shared.navigation,
      fmt,
      pathname,
      canonical: config.publicUrl + (pathname === '/' ? '/' : pathname),
      publicUrl: config.publicUrl,
      assets: resolveAssets(entry),
      nonce: reply.cspNonce?.script ?? '',
      path: reply.request.url,
      bookingHref,
      dev,
    });
    return reply.type('text/html; charset=utf-8').send(html);
  }
  app.decorateReply('page', page);

  // Sonde de santé (Docker, Caddy, supervision) : 200 si le serveur ET la base répondent.
  // Aucun détail dans la réponse : l'erreur réelle est journalisée.
  app.get('/health', async (request, reply) => {
    try {
      // La base doit répondre en moins de 2 s (sinon la sonde échoue au lieu de rester suspendue).
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('base de données trop lente (> 2 s)')), 2000);
      });
      try {
        await Promise.race([app.db.query('SELECT 1'), deadline]);
      } finally {
        clearTimeout(timer);
      }
      return { status: 'ok' };
    } catch (error) {
      request.log.error(error, 'sonde de santé : base injoignable');
      return reply.code(503).send({ status: 'error' });
    }
  });

  await app.register(siteRoutes);
  await app.register(servicesRoutes);
  await app.register(galleryRoutes);
  await app.register(reviewsRoutes, { config, now });
  await app.register(contentRoutes);
  await app.register(bookingRoutes, { config, now });
  await app.register(galleryMediaRoutes, { config });
  // Inventaire des routes de l'admin et nom du cookie : visibles de tout le serveur (tests d'accès).
  app.decorate('adminRoutes', []);
  app.decorate('adminCookie', sessionCookieName(config.isProd));
  // Back-office (§9) : contrôle d'accès par rôle sur chaque route, cf. modules/admin/guard.js.
  await app.register(adminShell, {
    prefix: '/admin',
    config,
    now,
    views: { render, assets: resolveAssets },
  });
  if (config.styleguideEnabled) await app.register(styleguideRoutes);

  // Erreurs inattendues : journalisées avec l'identifiant de requête, jamais détaillées au visiteur.
  app.setErrorHandler((/** @type {any} */ error, request, reply) => {
    const status = Number(error.statusCode);
    // Erreurs de validation (400, 413, 429…) : réponse standard de Fastify, déjà sans détail interne.
    if (status >= 400 && status < 500) return reply.send(error);
    if (error.name === 'ZodError') return reply.code(400).send({ error: 'Bad Request' });
    request.log.error({ err: error, reqId: request.id }, 'erreur interne');
    reply.code(500);
    if (request.headers.accept?.includes('text/html')) {
      return reply.page('pages/500', 'editorial', {
        title: 'Une erreur est survenue · L’Atelier des Locks',
        description: 'Une erreur est survenue.',
        noindex: true,
      });
    }
    return { error: 'Internal Server Error', reqId: request.id };
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404);
    if (request.headers.accept?.includes('text/html')) {
      return reply.page('pages/404', 'editorial', {
        title: 'Page introuvable · L’Atelier des Locks',
        description: 'Cette page n’existe pas ou plus.',
        noindex: true,
      });
    }
    return { error: 'Not Found' };
  });

  return app;
}
