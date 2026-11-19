// @ts-check
/**
 * Lecture et validation des variables d'environnement.
 * Toute la configuration de l'application passe par ici : aucun `process.env` ailleurs.
 */
import { existsSync } from 'node:fs';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Valeurs d'exemple refusées en production (§13). */
const PLACEHOLDER_SECRET = /remplacer|changeme|change-me|example|exemple|x{16}/i;

/**
 * Exigences de production : aucune valeur par défaut de développement ne doit survivre.
 * @param {Record<string, any>} env
 * @param {z.RefinementCtx} ctx
 */
function checkProduction(env, ctx) {
  /** @param {string} path @param {string} message */
  const fail = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (env.SESSION_SECRET.length < 43 || PLACEHOLDER_SECRET.test(env.SESSION_SECRET)) {
    fail(
      'SESSION_SECRET',
      "en production : secret aléatoire de 43 caractères ou plus, jamais la valeur d'exemple (openssl rand -base64 48)",
    );
  }
  if (!env.PUBLIC_URL.startsWith('https://'))
    fail('PUBLIC_URL', 'en production : adresse https obligatoire');
  if (env.DATABASE_URL.includes('atelier_dev'))
    fail('DATABASE_URL', 'en production : le mot de passe de développement est interdit');
  if (env.NOTIFICATIONS_PROVIDER === 'console')
    fail(
      'NOTIFICATIONS_PROVIDER',
      'en production : « brevo » obligatoire (« console » écrirait les emails dans les logs)',
    );
  if (env.ICAL_FEED_TOKEN && PLACEHOLDER_SECRET.test(env.ICAL_FEED_TOKEN))
    fail('ICAL_FEED_TOKEN', "valeur d'exemple interdite");
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PUBLIC_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL doit commencer par postgres://')
      .default('postgres://atelier:atelier_dev@localhost:5432/atelier_des_locks'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET doit faire au moins 32 caractères'),
    BOOKING_PROVIDER: z.enum(['internal', 'fresha_link']).default('internal'),
    FRESHA_BOOKING_URL: z.union([z.url(), z.literal('')]).default(''),
    // Flux iCal privé de la propriétaire (/agenda/<jeton>.ics). Vide = flux désactivé.
    ICAL_FEED_TOKEN: z
      .union([
        z.string().min(32, 'ICAL_FEED_TOKEN doit faire au moins 32 caractères'),
        z.literal(''),
      ])
      .default(''),
    // Photos envoyées par les clientes : dossier HORS du webroot, jamais servi publiquement.
    UPLOAD_DIR: z.string().min(1).default('storage/uploads'),
    // Réservations acceptées par adresse IP et par fenêtre de 10 minutes.
    BOOKING_RATE_LIMIT: z.coerce.number().int().min(1).max(10000).default(5),
    // Tentatives de connexion à l'admin acceptées par adresse IP et par fenêtre de 10 minutes.
    ADMIN_LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(10000).default(10),
    STYLEGUIDE_ENABLED: booleanString.optional(),
    // Notifications (§7.6) : « console » écrit les messages dans le terminal (dev, tests),
    // « brevo » les envoie vraiment (emails et SMS transactionnels).
    NOTIFICATIONS_PROVIDER: z.enum(['console', 'brevo']).default('console'),
    BREVO_API_KEY: z.string().default(''),
    BREVO_SENDER_EMAIL: z.union([z.email(), z.literal('')]).default(''),
    BREVO_SENDER_NAME: z.string().min(1).max(80).default('L’Atelier des Locks'),
    // Expéditeur alphanumérique des SMS : 11 caractères maximum, sans espace ni accent.
    SMS_SENDER: z
      .string()
      .regex(/^[A-Za-z0-9]{1,11}$/, 'SMS_SENDER : 11 caractères alphanumériques au maximum')
      .default('AtelierLock'),
    // Destinataire de l'alerte « nouveau rendez-vous » (la propriétaire). Vide = pas d'alerte.
    OWNER_EMAIL: z.union([z.email(), z.literal('')]).default(''),
    // Lien « Laisser un avis Google » proposé après le dépôt d'un avis (§8). Vide = pas de lien.
    GOOGLE_REVIEW_URL: z.union([z.url(), z.literal('')]).default(''),
    // Proxys de confiance pour X-Forwarded-For (adresses séparées par des virgules).
    // Par défaut : Caddy sur la même machine. Le port de l'application ne doit pas être exposé.
    TRUST_PROXY: z.string().min(1).default('127.0.0.1,::1'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') checkProduction(env, ctx);
    if (env.NOTIFICATIONS_PROVIDER === 'brevo') {
      for (const key of /** @type {const} */ (['BREVO_API_KEY', 'BREVO_SENDER_EMAIL'])) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} est obligatoire quand NOTIFICATIONS_PROVIDER=brevo`,
          });
        }
      }
    }
    if (env.BOOKING_PROVIDER === 'fresha_link' && !env.FRESHA_BOOKING_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['FRESHA_BOOKING_URL'],
        message: 'FRESHA_BOOKING_URL est obligatoire quand BOOKING_PROVIDER=fresha_link',
      });
    }
  });

/**
 * @typedef {object} AppConfig
 * @property {'development'|'test'|'production'} env
 * @property {boolean} isProd
 * @property {string} host
 * @property {number} port
 * @property {string} publicUrl
 * @property {string} databaseUrl
 * @property {string} sessionSecret
 * @property {string[]} trustProxy  proxys de confiance (X-Forwarded-For)
 * @property {{ provider: 'internal'|'fresha_link', freshaUrl: string, icalFeedToken: string, uploadDir: string, rateLimit: number }} booking
 * @property {{ provider: 'console'|'brevo', brevoApiKey: string, senderEmail: string, senderName: string, smsSender: string, ownerEmail: string }} notifications
 * @property {{ googleUrl: string }} reviews
 * @property {{ loginRateLimit: number }} admin
 * @property {boolean} styleguideEnabled
 */

/**
 * Construit la configuration à partir d'un objet d'environnement.
 * @param {Record<string, string | undefined>} [source]
 * @returns {AppConfig}
 */
export function loadConfig(source = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  const env = parsed.data;
  const isProd = env.NODE_ENV === 'production';
  return {
    env: env.NODE_ENV,
    isProd,
    host: env.HOST,
    port: env.PORT,
    publicUrl: env.PUBLIC_URL.replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL,
    sessionSecret: env.SESSION_SECRET,
    trustProxy: env.TRUST_PROXY.split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    booking: {
      provider: env.BOOKING_PROVIDER,
      freshaUrl: env.FRESHA_BOOKING_URL,
      icalFeedToken: env.ICAL_FEED_TOKEN,
      uploadDir: env.UPLOAD_DIR,
      rateLimit: env.BOOKING_RATE_LIMIT,
    },
    notifications: {
      provider: env.NOTIFICATIONS_PROVIDER,
      brevoApiKey: env.BREVO_API_KEY,
      senderEmail: env.BREVO_SENDER_EMAIL,
      senderName: env.BREVO_SENDER_NAME,
      smsSender: env.SMS_SENDER,
      ownerEmail: env.OWNER_EMAIL,
    },
    reviews: { googleUrl: env.GOOGLE_REVIEW_URL },
    admin: { loginRateLimit: env.ADMIN_LOGIN_RATE_LIMIT },
    styleguideEnabled: env.STYLEGUIDE_ENABLED ?? !isProd,
  };
}

/** Charge `.env` s'il existe (Node ≥ 20.12), sans écraser les variables déjà définies. */
export function loadDotEnv(path = '.env') {
  if (existsSync(path)) process.loadEnvFile(path);
}
