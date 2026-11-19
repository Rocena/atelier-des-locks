// @ts-check
/**
 * File de tâches persistante (§7.6). Deux implémentations de la même interface :
 *   - pg-boss  : en production et en dev, jobs conservés dans PostgreSQL (schéma `pgboss`),
 *                avec retries ; un redémarrage du serveur ne perd aucun rappel ;
 *   - mémoire  : tests unitaires, sans base ni minuterie.
 *
 * @typedef {object} JobQueue
 * @property {(name: string, data: import('./plan.js').JobData, options: { startAfter: Date }) => Promise<void>} send
 * @property {(name: string, handler: (data: import('./plan.js').JobData) => Promise<void>) => Promise<void>} work
 * @property {() => Promise<void>} start
 * @property {() => Promise<void>} stop
 */
import { PgBoss } from 'pg-boss';
import { ALL_QUEUES } from './plan.js';

/** 6 essais espacés de 1, 2, 4… minutes (délai croissant) : tient une coupure réseau de ~1 h. */
const RETRY = { retryLimit: 6, retryDelay: 60, retryBackoff: true, retryDelayMax: 3600 };

/**
 * @param {{ connectionString: string, onError?: (error: Error) => void }} options
 * @returns {JobQueue}
 */
export function createPgBossQueue({ connectionString, onError = () => {} }) {
  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    application_name: 'atelier-des-locks-jobs',
    max: 4,
  });
  boss.on('error', onError);
  return {
    async start() {
      await boss.start();
      for (const name of ALL_QUEUES) {
        // Rétention : les jobs programmés à l'avance (rappels à J-2) attendent jusqu'à ~60 jours.
        await boss.createQueue(name, { ...RETRY, retentionSeconds: 90 * 86_400 });
      }
    },
    async stop() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
    async send(name, data, { startAfter }) {
      await boss.send(name, data, { startAfter });
    },
    async work(name, handler) {
      // Les erreurs remontent à pg-boss, qui réessaie selon RETRY.
      await boss.work(name, { pollingIntervalSeconds: 10 }, async (jobs) => {
        for (const job of jobs)
          await handler(/** @type {import('./plan.js').JobData} */ (job.data));
      });
    },
  };
}

/**
 * File en mémoire : enregistre les jobs, les exécute à la demande (`runDue`). Pour les tests.
 * @returns {JobQueue & { jobs: { name: string, data: import('./plan.js').JobData, startAfter: Date, done: boolean }[], runDue: (now: Date) => Promise<number>, handlers: Map<string, (data: import('./plan.js').JobData) => Promise<void>> }}
 */
export function createMemoryQueue() {
  /** @type {{ name: string, data: import('./plan.js').JobData, startAfter: Date, done: boolean }[]} */
  const jobs = [];
  /** @type {Map<string, (data: import('./plan.js').JobData) => Promise<void>>} */
  const handlers = new Map();
  return {
    jobs,
    handlers,
    async start() {},
    async stop() {},
    async send(name, data, { startAfter }) {
      jobs.push({ name, data, startAfter, done: false });
    },
    async work(name, handler) {
      handlers.set(name, handler);
    },
    /** Exécute les jobs dont l'heure est venue. Renvoie leur nombre. @param {Date} now */
    async runDue(now) {
      let count = 0;
      for (const job of jobs.filter((j) => !j.done && j.startAfter <= now)) {
        job.done = true;
        await handlers.get(job.name)?.(job.data);
        count += 1;
      }
      return count;
    },
  };
}
