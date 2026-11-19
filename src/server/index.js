// @ts-check
/** Point d'entrée : charge la config, démarre Vite en dev, écoute le port. */
import { loadConfig, loadDotEnv } from './config.js';
import { buildApp } from './app.js';
import { runRetention } from './modules/retention/service.js';

loadDotEnv();
const config = loadConfig();

/** @type {import('vite').ViteDevServer | undefined} */
let vite;
if (!config.isProd) {
  const { createServer } = await import('vite');
  // Port HMR dérivé du port HTTP : deux serveurs de dev (ex. dev + e2e) ne se gênent pas.
  vite = await createServer({
    server: { middlewareMode: true, hmr: { port: config.port + 21000 } },
    appType: 'custom',
  });
}

const app = await buildApp({ config, vite });
// Jobs de notification (confirmations, rappels, demandes d'avis) : persistés dans PostgreSQL.
await app.notifications.start();

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, async () => {
    await app.close();
    await vite?.close();
    process.exit(0);
  });
}

// Purge quotidienne RGPD (§14) : 1 minute après le démarrage, puis toutes les 24 h.
const runPurge = async () => {
  try {
    const result = await runRetention(app.db, { uploadDir: config.booking.uploadDir });
    app.log.info({ retention: result }, 'purge RGPD terminée');
  } catch (error) {
    app.log.error(error, 'purge RGPD en échec');
  }
};
setTimeout(runPurge, 60_000).unref();
setInterval(runPurge, 24 * 3600_000).unref();
