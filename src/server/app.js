// @ts-check
/**
 * Création de l'application Fastify : plugins de sécurité, rendu des pages, modules métier.
 * Aucune logique métier ici : chaque domaine vit dans src/server/modules/<domaine>/.
 */
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { createAssetResolver } from './lib/assets.js';
import { createRenderer } from './lib/view.js';
import { site } from './lib/site.js';
import siteRoutes from './modules/site/routes.js';
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

  const resolveAssets = createAssetResolver({ dev: !config.isProd });
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
    const html = render(template, {
      ...data,
      site,
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
  if (config.styleguideEnabled) await app.register(styleguideRoutes);

  app.setNotFoundHandler((request, reply) => {
    reply.code(404);
    if (request.headers.accept?.includes('text/html')) {
      return reply.page('pages/404', 'home', { title: 'Page introuvable' });
    }
    return { error: 'Not Found' };
  });

  return app;
}
