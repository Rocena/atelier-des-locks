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
    STYLEGUIDE_ENABLED: booleanString.optional(),
  })
  .superRefine((env, ctx) => {
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
 * @property {{ provider: 'internal'|'fresha_link', freshaUrl: string }} booking
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
    booking: { provider: env.BOOKING_PROVIDER, freshaUrl: env.FRESHA_BOOKING_URL },
    styleguideEnabled: env.STYLEGUIDE_ENABLED ?? !isProd,
  };
}

/** Charge `.env` s'il existe (Node ≥ 20.12), sans écraser les variables déjà définies. */
export function loadDotEnv(path = '.env') {
  if (existsSync(path)) process.loadEnvFile(path);
}
