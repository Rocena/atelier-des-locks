// @ts-check
/**
 * Création de l'application Fastify : plugins de sécurité, rendu des pages, modules métier.
 * Aucune logique métier ici : chaque domaine vit dans src/server/modules/<domaine>/.
 */
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { createAssetResolver } from './lib/assets.js';
import { createRenderer } from './lib/view.js';
import { site } from './lib/site.js';
import { fmt } from './lib/format.js';
import siteRoutes from './modules/site/routes.js';
import catalogRoutes from './modules/catalog/routes.js';
import galleryRoutes from './modules/gallery/routes.js';
import reviewsRoutes from './modules/reviews/routes.js';
import journalRoutes from './modules/journal/routes.js';
import { findCatalog } from './modules/catalog/repo.js';
import { buildNavigation } from './modules/catalog/service.js';
import { findSettings } from './modules/site/repo.js';
import styleguideRoutes from './modules/styleguide/routes.js';

/**
 * @typedef {object} BuildOptions
 * @property {import('./config.js').AppConfig} config
 * @property {import('vite').ViteDevServer} [vite]  serveur Vite en mode middleware (dev)
 * @property {boolean} [logger]
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
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'"],
    connectSrc: dev ? ["'self'", 'ws:'] : ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: dev ? null : [],
  };
}

/** @param {BuildOptions} options */
export async function buildApp({ config, vite, logger = true }) {
  const dev = !config.isProd;
  const app = Fastify({
    logger: logger && {
      level: config.env === 'test' ? 'silent' : 'info',
      // Jamais de données personnelles dans les logs : on masque les en-têtes sensibles.
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    trustProxy: config.isProd,
  });

  await app.register(helmet, {
    enableCSPNonces: true,
    contentSecurityPolicy: { directives: cspDirectives(dev) },
    hsts: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

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

  const resolveAssets = createAssetResolver({ dev: !config.isProd });
  // Données communes à toutes les pages (méga-menu, bandeau d'annonce).
  // Phase 3 : relues en base à chaque requête (ou mises en cache avec invalidation admin).
  const { categories, services } = await findCatalog();
  const navigation = buildNavigation(categories, services);
  const settings = await findSettings();
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
      settings,
      ...data,
      jsonLd,
      site,
      navigation,
      fmt,
      pathname,
      canonical: config.publicUrl + (pathname === '/' ? '/' : pathname),
      publicUrl: config.publicUrl,
      assets: resolveAssets(entry),
      nonce: reply.cspNonce?.script ?? '',
      path: reply.request.url,
      dev,
    });
    return reply.type('text/html; charset=utf-8').send(html);
  }
  app.decorateReply('page', page);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(siteRoutes);
  await app.register(catalogRoutes);
  await app.register(galleryRoutes);
  await app.register(reviewsRoutes);
  await app.register(journalRoutes);
  if (config.styleguideEnabled) await app.register(styleguideRoutes);

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
